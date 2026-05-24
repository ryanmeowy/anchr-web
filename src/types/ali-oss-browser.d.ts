declare module "ali-oss/dist/aliyun-oss-sdk.min.js" {
  type OssOptions = {
    bucket: string;
    endpoint: string;
    accessKeyId: string;
    accessKeySecret: string;
    stsToken: string;
    secure?: boolean;
  };

  export default class OSS {
    constructor(options: OssOptions);

    put(
      objectKey: string,
      file: File,
      options: { headers: Record<string, string> },
    ): Promise<unknown>;
  }
}
