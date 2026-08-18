/**
 * JSON schemas for the card-extraction prompts, used as OpenAI Structured Outputs.
 *
 * Each schema mirrors the "Output a list of cards in the following JSON format" block of the
 * matching prompt file, including its entity list — the prompts deliberately allow different
 * entities (only CardsFromText offers `person`; only Image/Text offer `task`), so widening a
 * schema here would change what the model is allowed to emit.
 *
 * Strict mode constrains what is expressible: every property must be listed in `required`, and
 * `additionalProperties` must be false on every object. Length limits are therefore stated in
 * prose in the prompt files, not here.
 */

type JsonSchema = { [key: string]: unknown };

const TEXT_ENTITIES = ["person", "requirement", "concept", "insight", "object", "task"];
const IMAGE_ENTITIES = ["requirement", "concept", "insight", "object", "task"];
const DATA_ENTITIES = ["requirement", "concept", "insight", "object"];
// CardsFromTextInput's worked examples emit `activity` cards even though its bullet list omits
// the entity, so the enum has to allow it or the prompt's own examples become unreachable.
const TEXT_INPUT_ENTITIES = [...TEXT_ENTITIES, "activity"];

type CardSchemaOptions = {
    entities: string[];
    /** Prompts differ on whether they ask the model to number the cards. */
    includeId: boolean;
    /** The role classification step; CardsFromTextInput has no such step. */
    includeRole: boolean;
    /** The verbatim source excerpt backing the card. */
    includeReference: boolean;
};

function buildCardsSchema(options: CardSchemaOptions): JsonSchema {
    const cardProperties: JsonSchema = {
        entity: { type: "string", enum: options.entities },
        title: { type: "string" },
        description: { type: "string" },
    };
    if (options.includeId) cardProperties.id = { type: "integer" };
    if (options.includeReference) cardProperties.reference = { type: "string" };

    const rootProperties: JsonSchema = {
        cards: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                // Strict mode requires every declared property to be required.
                required: Object.keys(cardProperties),
                properties: cardProperties,
            },
        },
    };
    if (options.includeRole) rootProperties.role = { type: "string" };

    return {
        type: "object",
        additionalProperties: false,
        required: Object.keys(rootProperties),
        properties: rootProperties,
    };
}

const CARD_OUTPUT_SCHEMAS: Record<string, JsonSchema> = {
    CardsFromText: buildCardsSchema({
        entities: TEXT_ENTITIES,
        includeId: true,
        includeRole: true,
        includeReference: true,
    }),
    CardsFromData: buildCardsSchema({
        entities: DATA_ENTITIES,
        includeId: true,
        includeRole: true,
        includeReference: true,
    }),
    CardsFromCode: buildCardsSchema({
        entities: DATA_ENTITIES,
        includeId: false,
        includeRole: true,
        includeReference: true,
    }),
    CardsFromImage: buildCardsSchema({
        entities: IMAGE_ENTITIES,
        includeId: false,
        includeRole: true,
        includeReference: true,
    }),
    CardsFromTextInput: buildCardsSchema({
        entities: TEXT_INPUT_ENTITIES,
        includeId: false,
        includeRole: false,
        includeReference: false,
    }),
};

/**
 * The structured-output schema for a prompt, or undefined when the prompt has no fixed shape
 * (the Artifact/Milestone/report prompts) and should keep emitting free-form JSON.
 */
export function getCardsOutputSchema(promptName: string): JsonSchema | undefined {
    return CARD_OUTPUT_SCHEMAS[promptName];
}
