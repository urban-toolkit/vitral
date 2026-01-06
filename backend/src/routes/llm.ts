// src/routes/llm.ts
import { FastifyPluginAsync } from "fastify";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const llmRoutes: FastifyPluginAsync = async (app) => {
  app.post("/chat", async (request, reply) => {
    try {
      // Validate request body
      const body = request.body as { messages: { role: string; content: string }[] };
      if (!body?.messages || !Array.isArray(body.messages)) {
        return reply.status(400).send({ error: "Invalid messages array" });
      }

      // Convert messages to a single string for the new Responses API
      const inputText = body.messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      // Call OpenAI Responses API (new SDK)
      const response = await client.responses.create({
        model: "gpt-5-nano", // or whatever model you want
        input: inputText,
      });

      // Return the generated text
      return { output: response.output_text };
    } catch (err) {
      console.error("OpenAI API error:", err);
      return reply.status(500).send({ error: "LLM request failed" });
    }
  });
};
