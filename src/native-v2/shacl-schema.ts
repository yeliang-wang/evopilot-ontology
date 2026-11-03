// Generated from schemas/v2/shacl.schema.json; edit the schema, then regenerate.
export const SHACL_SCHEMA_DIGEST = "sha256:505ee7bfe10b1964cf56cceceddb5fcdcf843ec0e209bb7921921a969f4c63df";
export const SHACL_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evopilot:ontology:shacl-request:v2",
  "title": "SHACLRequest",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "requestId",
    "modelDigest",
    "view",
    "shapes",
    "expectations"
  ],
  "properties": {
    "schema": {
      "type": "string",
      "const": "ontology-shacl-request/v2"
    },
    "requestId": {
      "$ref": "#/$defs/Identifier"
    },
    "modelDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "view": {
      "oneOf": [
        {
          "$ref": "#/$defs/AssertedView"
        },
        {
          "$ref": "#/$defs/DerivedView"
        }
      ]
    },
    "shapes": {
      "type": "array",
      "minItems": 1,
      "maxItems": 64,
      "items": {
        "$ref": "#/$defs/ModelDocument"
      }
    },
    "expectations": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "digest",
        "requiredShapes"
      ],
      "properties": {
        "digest": {
          "$ref": "#/$defs/SHA256"
        },
        "requiredShapes": {
          "type": "array",
          "minItems": 1,
          "maxItems": 1000,
          "items": {
            "$ref": "#/$defs/RequiredShape"
          }
        }
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
    "OptionalIRI": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/OptionalIRI"
    },
    "ModelDocument": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/ModelDocument"
    },
    "ModelClosure": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/ModelClosure"
    },
    "IRI": {
      "type": "string",
      "minLength": 1,
      "maxLength": 4096,
      "pattern": "^[A-Za-z][A-Za-z0-9+.-]*:[^\\s<>\"{}|\\\\^`]*(?![\\s\\S])"
    },
    "RequiredShape": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "shapeIri",
        "requiredFocusIris",
        "minimumFocusCount"
      ],
      "properties": {
        "shapeIri": {
          "$ref": "#/$defs/IRI"
        },
        "requiredFocusIris": {
          "type": "array",
          "minItems": 0,
          "maxItems": 1000,
          "items": {
            "$ref": "#/$defs/IRI"
          }
        },
        "minimumFocusCount": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20000
        }
      }
    },
    "AssertedView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "closure"
      ],
      "properties": {
        "kind": {
          "type": "string",
          "const": "asserted"
        },
        "closure": {
          "$ref": "#/$defs/ModelClosure"
        }
      }
    },
    "DerivedView": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "closure",
        "projectionDigest",
        "document"
      ],
      "properties": {
        "kind": {
          "type": "string",
          "const": "derived"
        },
        "closure": {
          "$ref": "#/$defs/ModelClosure"
        },
        "projectionDigest": {
          "$ref": "#/$defs/SHA256"
        },
        "document": {
          "$ref": "#/$defs/ModelDocument"
        }
      }
    }
  }
} as const;
