import { advanceTo, advanceBy } from "jest-date-mock";
import client from "./client";
import { versionInfo } from "../util";
import { gql } from "./apollo";

const Logs = gql`
  query Logs {
    configurator @client {
      logs {
        message
        time
      }
    }
  }
` as import("@graphql-typed-document-node/core").TypedDocumentNode<
  import("./__generated__/client.spec").LogsQuery,
  import("./__generated__/client.spec").LogsQueryVariables
>;

const Log = gql`
  mutation Log($message: String!) {
    log(message: $message) @client
  }
` as import("@graphql-typed-document-node/core").TypedDocumentNode<
  import("./__generated__/client.spec").LogMutation,
  import("./__generated__/client.spec").LogMutationVariables
>;

beforeEach(async () => {
  advanceTo(new Date("2020-03-01T19:00:00.000Z"));
  await client.resetStore();
});

describe("client", () => {
  describe("configurator", () => {
    it("should allow logs to be appended", async () => {
      let { data } = await client.query({
        query: Logs,
      });

      const initialMessage = {
        __typename: "Log",
        message: `Running - OS: <strong>Unknown</strong>, Chrome: <strong>4.0</strong>, Configurator: <strong>${
          versionInfo().version
        }</strong>`,
        time: "2020-03-01T19:00:00.000Z",
      };

      expect(data.configurator.logs).toEqual([initialMessage]);

      // Move time forward by 50 minutes
      advanceBy(60 * 1000 * 50);

      const response = await client.mutate({
        mutation: Log,
        variables: {
          message: "Some message to log",
        },
      });

      expect(response.errors).toBeFalsy();

      ({ data } = await client.query({
        query: Logs,
      }));

      expect(data.configurator.logs).toEqual([
        initialMessage,
        {
          __typename: "Log",
          message: "Some message to log",
          time: "2020-03-01T19:50:00.000Z",
        },
      ]);
    });
  });
});
