export type SerializableGraphQLRequest<
  TContext = Record<string, string>,
  TVariables = Record<string, string>,
  TExtensions = Record<string, string>
> = {
  query: string;
  operationName?: string;
  variables?: TVariables;
  context?: TContext;
  extensions?: TExtensions;
};
