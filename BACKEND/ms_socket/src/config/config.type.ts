export type AppConfig = {
  nodeEnv: string;
  name: string;
  workingDirectory: string;
  frontendDomain?: string;
  backendDomain: string;
  port: number;
  apiPrefix: string;
  authHost: string;
  adminHost: string;
};

export type AllConfigType = {
  app: AppConfig;
};
