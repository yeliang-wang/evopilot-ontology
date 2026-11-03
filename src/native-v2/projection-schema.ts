// Generated from schemas/v2/projection.schema.json; edit the schema, then regenerate.
export const PROJECTION_SCHEMA_DIGEST = "sha256:b16770765148c8c2d2eb8ac993c62b0fce3845a8187eb080e8b46254c4d92616";
export const PROJECTION_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evopilot:ontology:derived-view:v2",
  "title": "DerivedView",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "assetId",
    "modelDigest",
    "sourceSetDigest",
    "closureDigest",
    "scope",
    "composition",
    "allLogicalConsequences",
    "tasks",
    "triples"
  ],
  "properties": {
    "schema": {
      "type": "string",
      "const": "ontology-derived-view/v2"
    },
    "assetId": {
      "$ref": "#/$defs/Identifier"
    },
    "modelDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "sourceSetDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "closureDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "scope": {
      "type": "string",
      "const": "NAMED_REQUESTED_ENTITIES"
    },
    "composition": {
      "type": "string",
      "const": "ASSERTED_PLUS_NAMED_PROJECTION"
    },
    "allLogicalConsequences": {
      "type": "boolean",
      "const": false
    },
    "tasks": {
      "type": "array",
      "minItems": 1,
      "maxItems": 8,
      "items": {
        "$ref": "#/$defs/TaskBinding"
      }
    },
    "triples": {
      "type": "array",
      "minItems": 0,
      "maxItems": 50000,
      "items": {
        "$ref": "#/$defs/Triple"
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
    "IRI": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4096,
      "pattern": "^[A-Za-z][A-Za-z0-9+.-]*:[^\\s<>\"{}|\\\\^`]*(?![\\s\\S])"
    },
    "TaskBinding": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "taskId",
        "requestDigest",
        "resultDigest",
        "configurationDigest",
        "toolchainDigest",
        "kind",
        "direct",
        "entities",
        "omittedInverseExpressions"
      ],
      "properties": {
        "taskId": {
          "$ref": "#/$defs/Identifier"
        },
        "requestDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "resultDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "configurationDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "toolchainDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "kind": {
          "type": "string",
          "enum": [
            "classHierarchy",
            "objectPropertyHierarchy",
            "dataPropertyHierarchy",
            "realization",
            "identity"
          ]
        },
        "direct": {
          "oneOf": [
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "entities": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1000,
          "items": {
            "$ref": "#/$defs/IRI"
          }
        },
        "omittedInverseExpressions": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1000000
        }
      }
    },
    "Triple": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "subject",
        "predicate",
        "object",
        "taskIds"
      ],
      "properties": {
        "subject": {
          "$ref": "#/$defs/IRI"
        },
        "predicate": {
          "$ref": "#/$defs/IRI"
        },
        "object": {
          "$ref": "#/$defs/IRI"
        },
        "taskIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        }
      }
    }
  }
} as const;
