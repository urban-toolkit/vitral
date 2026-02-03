import fp from "fastify-plugin";
import { S3Client } from "@aws-sdk/client-s3";

declare module "fastify" {
    interface FastifyInstance {
        s3: S3Client;
    }
}

export default fp(async (app) => {
    const s3 = new S3Client({
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID!,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        },
    });

    app.decorate("s3", s3);

    app.addHook("onClose", async () => {
    });
});