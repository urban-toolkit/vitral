import { FastifyPluginAsync } from "fastify";
import OpenAI from "openai";
import { loadPrompt } from "../prompts/loadPrompt.ts";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export const llmRoutes: FastifyPluginAsync = async (app) => {
    app.post("/chat", async (request, reply) => {
        try {

            const body = request.body as {input: string, prompt?: string};

            if (!body?.input) {
                return reply.status(400).send({ error: "Invalid messages array" });
            }

            let promptContent = "";

            if(body?.prompt){
                promptContent = await loadPrompt(body?.prompt);
            }else{
                promptContent = await loadPrompt("CardsFromFile");
            }

            const response = await client.responses.create({
                model: "gpt-5-nano",
                input: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "input_text",
                                text: promptContent + "\n" + body.input
                            }
                        ]
                    }
                ],
            });

            return { output: response.output_text };
        } catch (err) {
            console.error("OpenAI API error:", err);
            return reply.status(500).send({ error: "LLM request failed" });
        }
    });
};
