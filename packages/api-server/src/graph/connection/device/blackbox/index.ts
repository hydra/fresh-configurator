import { ApolloError } from "apollo-server-express";
import gql from "graphql-tag";
import * as uuid from "uuid";
import fs from "fs";
import debug from "debug";
import { format } from "date-fns";
import { Resolvers, JobType } from "../../../__generated__";

const log = debug("api-server:blackbox");

const typeDefs = gql`
  type Mutation {
    createFlashDataOffloadJob(connectionId: ID!, chunkSize: Int!): JobDetails!
    deviceEraseFlashData(connectionId: ID!): Boolean
    deviceSetBlackboxConfig(
      connectionId: ID!
      config: BlackboxConfigInput!
    ): Boolean
  }

  type FlightController {
    blackbox: Blackbox!
  }

  type OffloadJobError {
    message: String!
  }

  type Blackbox {
    supported: Boolean!
    config: BlackboxConfig!
    flash: BlackboxFlash!
    sdCard: BlackboxSdCard!
  }

  type BlackboxConfig {
    device: Int!
    rateNum: Int!
    rateDenom: Int!
    pDenom: Int!
    sampleRate: Int!
  }

  input BlackboxConfigInput {
    device: Int
    rateNum: Int
    rateDenom: Int
    pDenom: Int
    sampleRate: Int
  }

  type BlackboxFlash {
    ready: Boolean!
    supported: Boolean!
    sectors: Int!
    totalSize: Int!
    usedSize: Int!
  }

  type BlackboxSdCard {
    supported: Boolean!
    state: Int!
    filesystemLastError: Int!
    freeSizeKB: Int!
    totalSizeKB: Int!
  }
`;

const resolvers: Resolvers = {
  FlightController: {
    blackbox: () => ({} as never),
  },
  Blackbox: {
    supported: (_, __, { api, port }) =>
      api.readBlackboxConfig(port).then(({ supported }) => supported),
    config: (_, __, { api, port }) => api.readBlackboxConfig(port),
    flash: (_, __, { api, port }) => api.readDataFlashSummary(port),
    sdCard: (_, __, { api, port }) => api.readSdCardSummary(port),
  },

  Mutation: {
    deviceEraseFlashData: (_, { connectionId }, { connections, api }) =>
      api.eraseDataFlash(connections.getPort(connectionId)).then(() => null),
    deviceSetBlackboxConfig: (
      _,
      { connectionId, config },
      { connections, api }
    ) =>
      api
        .writePartialBlackboxConfig(connections.getPort(connectionId), config)
        .then(() => null),
    createFlashDataOffloadJob: async (
      _,
      { connectionId, chunkSize },
      { connections, jobs, api, artifactsDir }
    ) => {
      const port = connections.getPort(connectionId);
      const [{ usedSize, ready }, variant, name] = await Promise.all([
        api.readDataFlashSummary(port),
        api.readFcVariant(port),
        api.readName(port),
      ]);
      if (!ready) {
        throw new ApolloError("Flash data is not ready to be read");
      }

      const jobId = uuid.v4();

      await fs.promises
        .mkdir(artifactsDir)
        .catch((e: { code?: string } & Error) => {
          if (e.code !== "EEXIST") {
            throw new ApolloError(
              `Could not create artifacts directory: ${e.message}`
            );
          }
        });
      if (!(await fs.promises.lstat(artifactsDir)).isDirectory()) {
        throw new ApolloError(
          `Artifacts directory (${artifactsDir}) is not a directory`
        );
      }

      const now = new Date();
      const artifact = `${[
        "blackbox_log",
        variant,
        name,
        format(now, "yyyyMMdd"),
        format(now, "hhmmss"),
      ]
        .map((s) => s.split(" ").join(""))
        .filter((s) => s !== "")
        .join("_")}.bbl`;

      const offloadFilePath = `${artifactsDir}/${artifact}`;
      const offloadFile = await fs.promises.open(offloadFilePath, "w");
      log(
        `Created flash data offload job: ${jobId}. Expecting to read ${usedSize}`
      );

      jobs.add(jobId, JobType.Offload, connectionId);

      (async () => {
        let address = 0;
        let fileError: Error | undefined;
        while (
          api.isOpen(port) &&
          connections.isOpen(connectionId) &&
          address < usedSize &&
          jobs.details(jobId) &&
          !jobs.details(jobId)?.cancelled
        ) {
          log(`Reading chunk ${address}`);
          // eslint-disable-next-line no-await-in-loop
          const chunk = await api
            .readDataFlashChunk(port, address, chunkSize)
            // eslint-disable-next-line @typescript-eslint/no-loop-func
            .catch((e) => {
              log(`Error reading chunk ${address}: ${e.message}`);
              return undefined;
            });

          if (chunk) {
            log(`Read chunk ${chunk.byteLength}`);
            if (chunk.length < 1) {
              break;
            }
            try {
              // eslint-disable-next-line no-await-in-loop
              await offloadFile.write(chunk);
            } catch (e) {
              fileError = e;
              break;
            }
            address += chunk.byteLength;
            jobs.progress(jobId, address);
          }
        }

        const connectionClosed =
          !api.isOpen(port) || !connections.isOpen(connectionId)
            ? { message: "Connection closed to device" }
            : undefined;
        const cancelled = jobs.details(jobId)?.cancelled;
        const errorClosing = await offloadFile
          .close()
          .then(() => undefined)
          .catch((e: Error) => {
            log(`Error closing file: ${e.message}`);
            return { message: "Could not finish storing data offload" };
          });

        const error = errorClosing ?? connectionClosed ?? fileError;

        if (!error && !cancelled) {
          jobs.completed(jobId, { artifact });
        } else {
          await fs.promises.unlink(offloadFilePath).catch((e) => {
            log(`Error removing file after error: ${e.message}`);
          });

          jobs.completed(jobId, { error });
        }
      })();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return { id: jobId, ...jobs.details(jobId)! };
    },
  },
};

export default {
  resolvers,
  typeDefs,
};
