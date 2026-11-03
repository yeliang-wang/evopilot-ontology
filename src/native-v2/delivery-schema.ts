// Generated from schemas/v2/delivery.schema.json; edit the schema, then regenerate.
export const DELIVERY_SCHEMA_DIGEST = "sha256:6fe7715d855c85686ea9ee09bf893b7acbc398921ff6e203838e51e16fa7b8b9";
export const DELIVERY_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evopilot:ontology:delivery:v2",
  "title": "DeliveryBundle",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "identity",
    "candidateDigest",
    "reviewDigest",
    "previousDeliveryDigest",
    "publisherPrincipalId",
    "recordedAt",
    "visibility",
    "parts"
  ],
  "properties": {
    "schema": {
      "type": "string",
      "const": "ontology-delivery-bundle/v2"
    },
    "identity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "workspaceId",
        "serviceId",
        "projectId",
        "assetId",
        "version"
      ],
      "properties": {
        "workspaceId": {
          "$ref": "#/$defs/Identifier"
        },
        "serviceId": {
          "$ref": "#/$defs/Identifier"
        },
        "projectId": {
          "$ref": "#/$defs/Identifier"
        },
        "assetId": {
          "$ref": "#/$defs/Identifier"
        },
        "version": {
          "$ref": "#/$defs/Identifier"
        }
      }
    },
    "candidateDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "reviewDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "previousDeliveryDigest": {
      "oneOf": [
        {
          "$ref": "#/$defs/SHA256"
        },
        {
          "type": "null"
        }
      ]
    },
    "publisherPrincipalId": {
      "$ref": "#/$defs/Identifier"
    },
    "recordedAt": {
      "type": "string",
      "minLength": 1,
      "maxLength": 32
    },
    "visibility": {
      "type": "string",
      "const": "private"
    },
    "parts": {
      "type": "array",
      "minItems": 7,
      "maxItems": 49,
      "items": {
        "$ref": "#/$defs/Part"
      }
    }
  },
  "$defs": {
    "Identifier": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/Identifier"
    },
    "SHA256": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/SHA256"
    },
    "Part": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "kind",
        "digest",
        "content"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "kind": {
          "type": "string",
          "enum": [
            "candidate",
            "decision",
            "intent",
            "source-set",
            "expectations",
            "model",
            "validation",
            "explanation",
            "derived-view",
            "projection-task"
          ]
        },
        "digest": {
          "$ref": "#/$defs/SHA256"
        },
        "content": {
          "type": "string",
          "minLength": 1,
          "maxLength": 33554432
        }
      }
    }
  }
} as const;
