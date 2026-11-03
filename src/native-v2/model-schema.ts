// Generated from schemas/v2/model.schema.json; edit the schema, then regenerate.
export const MODEL_SCHEMA_DIGEST = "sha256:62c04811fd4cafd04d8bc6803f94ca73ab9c647d2563d08bc1f2800e71e01d4d";
export const MODEL_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evopilot:ontology:model-draft:v2",
  "title": "ModelDraft",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "assetId",
    "label",
    "intentDigest",
    "sourceSetDigest",
    "previousDigest",
    "closure",
    "shapes",
    "mappings",
    "openIssues"
  ],
  "properties": {
    "schema": {
      "type": "string",
      "const": "ontology-model-draft/v2"
    },
    "assetId": {
      "$ref": "#/$defs/Identifier"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "intentDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "sourceSetDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "expectationsDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "previousDigest": {
      "oneOf": [
        {
          "$ref": "#/$defs/SHA256"
        },
        {
          "type": "null"
        }
      ]
    },
    "closure": {
      "$ref": "#/$defs/ModelClosure"
    },
    "shapes": {
      "type": "array",
      "maxItems": 64,
      "items": {
        "$ref": "#/$defs/ModelDocument"
      }
    },
    "mappings": {
      "type": "array",
      "maxItems": 1000,
      "items": {
        "$ref": "#/$defs/RequirementMapping"
      }
    },
    "openIssues": {
      "type": "array",
      "maxItems": 1000,
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4000
      }
    }
  },
  "$defs": {
    "Identifier": {
      "type": "string",
      "pattern": "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}(?![\\s\\S])"
    },
    "SHA256": {
      "type": "string",
      "pattern": "^sha256:[a-f0-9]{64}(?![\\s\\S])"
    },
    "OptionalIRI": {
      "oneOf": [
        {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        {
          "type": "null"
        }
      ]
    },
    "ModelDocument": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "documentIri",
        "ontologyIri",
        "versionIri",
        "format",
        "content",
        "digest"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "documentIri": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4096
        },
        "ontologyIri": {
          "$ref": "#/$defs/OptionalIRI"
        },
        "versionIri": {
          "$ref": "#/$defs/OptionalIRI"
        },
        "format": {
          "type": "string",
          "enum": [
            "turtle",
            "rdfxml"
          ]
        },
        "content": {
          "type": "string",
          "maxLength": 8388608
        },
        "digest": {
          "$ref": "#/$defs/SHA256"
        }
      }
    },
    "ModelClosure": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "rootDocumentId",
        "documents",
        "imports"
      ],
      "properties": {
        "rootDocumentId": {
          "$ref": "#/$defs/Identifier"
        },
        "documents": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/ModelDocument"
          }
        },
        "imports": {
          "type": "array",
          "maxItems": 512,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "from",
              "iri",
              "to"
            ],
            "properties": {
              "from": {
                "$ref": "#/$defs/Identifier"
              },
              "iri": {
                "type": "string",
                "minLength": 1,
                "maxLength": 4096
              },
              "to": {
                "$ref": "#/$defs/Identifier"
              }
            }
          }
        }
      }
    },
    "ModelAnchor": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "documentId",
        "documentDigest",
        "start",
        "end",
        "fragmentDigest"
      ],
      "properties": {
        "documentId": {
          "$ref": "#/$defs/Identifier"
        },
        "documentDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "start": {
          "type": "integer",
          "minimum": 0,
          "maximum": 8388608
        },
        "end": {
          "type": "integer",
          "minimum": 0,
          "maximum": 8388608
        },
        "fragmentDigest": {
          "$ref": "#/$defs/SHA256"
        }
      }
    },
    "RequirementMapping": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirementId",
        "sourceFragmentIds",
        "anchors",
        "rationale"
      ],
      "properties": {
        "requirementId": {
          "$ref": "#/$defs/Identifier"
        },
        "sourceFragmentIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/Identifier"
          }
        },
        "anchors": {
          "type": "array",
          "minItems": 1,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/ModelAnchor"
          }
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        }
      }
    }
  }
} as const;
