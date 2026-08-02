import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apiOperations } from "../src/api/operations.js";
import {
  calendarCreateFieldNames,
  calendarCreateInputJsonSchema,
  calendarUpdateFieldNames,
  calendarUpdateInputJsonSchema,
} from "../src/commands/calendar/input-contract.js";
import {
  notesUpdateFieldNames,
  notesUpdateInputJsonSchema,
} from "../src/commands/notes/input-contract.js";

describe("fixed OpenAPI contract", () => {
  it("pins every adapter method, security, scope, and schema", async () => {
    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "contracts", "openapi-v1.json"),
        "utf8",
      ),
    );

    for (const adapter of Object.values(apiOperations)) {
      expect(adapter.path).toBe(`/open-api/v1${adapter.openApiPath}`);
      const operation =
        schema.paths[adapter.openApiPath][adapter.method.toLowerCase()];
      expect(operation.security).toEqual([{ OpenPlatformBearer: [] }]);
      expect(operation["x-required-scopes"]).toEqual(adapter.requiredScopes);
      if (adapter.requestSchemaRef === null) {
        expect(operation.requestBody).toBeUndefined();
      } else {
        expect(
          operation.requestBody.content["application/json"].schema,
        ).toEqual({ $ref: adapter.requestSchemaRef });
      }
      const successResponse =
        operation.responses[
          "successStatus" in adapter ? adapter.successStatus : "200"
        ];
      if (adapter.responseSchemaRef === null) {
        expect(successResponse.content).toBeUndefined();
      } else {
        expect(successResponse.content["application/json"].schema).toEqual({
          $ref: adapter.responseSchemaRef,
        });
      }
    }
  });

  it("keeps the Notes update runtime/help input contract aligned with OpenAPI", async () => {
    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "contracts", "openapi-v1.json"),
        "utf8",
      ),
    );
    const openApiInput = schema.components.schemas.UpdateQuickNoteRequestDTO;

    expect(openApiInput.additionalProperties).toBe(false);
    expect(Object.keys(openApiInput.properties).sort()).toEqual(
      [...notesUpdateFieldNames].sort(),
    );
    expect(notesUpdateInputJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      minProperties: 1,
    });
    for (const field of notesUpdateFieldNames) {
      expect(
        openApiInput.properties[field].anyOf
          .map((candidate: { type: string }) => candidate.type)
          .sort(),
      ).toEqual(
        notesUpdateInputJsonSchema.properties[field].anyOf
          .map((candidate) => candidate.type)
          .sort(),
      );
    }
  });

  it.each([
    [
      "CreateCalendarEventRequestDTO",
      calendarCreateFieldNames,
      calendarCreateInputJsonSchema,
    ],
    [
      "UpdateCalendarEventRequestDTO",
      calendarUpdateFieldNames,
      calendarUpdateInputJsonSchema,
    ],
  ])("keeps %s field names aligned with OpenAPI", async (schemaName, fields, inputSchema) => {
    const schema = JSON.parse(
      await readFile(
        join(process.cwd(), "contracts", "openapi-v1.json"),
        "utf8",
      ),
    );
    const openApiInput = schema.components.schemas[schemaName];

    expect(openApiInput.additionalProperties).toBe(false);
    expect(Object.keys(openApiInput.properties).sort()).toEqual(
      [...fields].sort(),
    );
    expect(inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });
});
