// Generated from schemas/v2/expectations.schema.json; edit the schema, then regenerate.
export const EXPECTATIONS_SCHEMA_DIGEST = "sha256:19a5704780dc0ebabc1c2bc4cab507b0c2e09c18a5cb19a59406aaa2ee03a533";
export const EXPECTATIONS_SCHEMA = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:evopilot:ontology:expectations:v2",
  "title": "ExpectationSet",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "assetId",
    "intentDigest",
    "sourceSetDigest",
    "previousDigest",
    "requirements",
    "requiredShapes",
    "cases"
  ],
  "properties": {
    "schema": {
      "type": "string",
      "const": "ontology-expectations/v2"
    },
    "assetId": {
      "$ref": "#/$defs/Identifier"
    },
    "intentDigest": {
      "$ref": "#/$defs/SHA256"
    },
    "sourceSetDigest": {
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
    "requirements": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/RequirementExpectation"
      },
      "minItems": 0,
      "maxItems": 1000
    },
    "requiredShapes": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/RequiredShape"
      },
      "minItems": 1,
      "maxItems": 1000
    },
    "cases": {
      "type": "array",
      "items": {
        "oneOf": [
          {
            "$ref": "#/$defs/OWLCase"
          },
          {
            "$ref": "#/$defs/SHACLCase"
          }
        ]
      },
      "minItems": 0,
      "maxItems": 32
    }
  },
  "$defs": {
    "Identifier": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/Identifier"
    },
    "SHA256": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/SHA256"
    },
    "ModelClosure": {
      "$ref": "urn:evopilot:ontology:model-draft:v2#/$defs/ModelClosure"
    },
    "RequiredShape": {
      "$ref": "urn:evopilot:ontology:shacl-request:v2#/$defs/RequiredShape"
    },
    "IRI": {
      "$ref": "urn:evopilot:ontology:shacl-request:v2#/$defs/IRI"
    },
    "RequirementExpectation": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "requirementId",
        "sourceFragmentIds",
        "methods",
        "rationale",
        "targetShapeIris",
        "constraintShapeIris"
      ],
      "properties": {
        "requirementId": {
          "$ref": "#/$defs/Identifier"
        },
        "sourceFragmentIds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          },
          "minItems": 1,
          "maxItems": 64
        },
        "methods": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "owl",
              "shacl"
            ]
          },
          "minItems": 1,
          "maxItems": 2
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "targetShapeIris": {
          "type": "array",
          "minItems": 0,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/IRI"
          }
        },
        "constraintShapeIris": {
          "type": "array",
          "minItems": 0,
          "maxItems": 64,
          "items": {
            "$ref": "#/$defs/IRI"
          }
        }
      }
    },
    "OWLQuery": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "format",
        "content",
        "digest"
      ],
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "turtle",
            "rdfxml",
            "functional"
          ]
        },
        "content": {
          "type": "string",
          "minLength": 1,
          "maxLength": 8388608
        },
        "digest": {
          "$ref": "#/$defs/SHA256"
        }
      }
    },
    "OWLCase": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "requirementIds",
        "sourceFragmentIds",
        "rationale",
        "kind",
        "query",
        "expectedStatus"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "requirementIds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          },
          "minItems": 1,
          "maxItems": 64
        },
        "sourceFragmentIds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          },
          "minItems": 1,
          "maxItems": 64
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "kind": {
          "type": "string",
          "const": "owl-entailment"
        },
        "query": {
          "$ref": "#/$defs/OWLQuery"
        },
        "expectedStatus": {
          "type": "string",
          "enum": [
            "ENTAILED",
            "NOT_ENTAILED"
          ]
        }
      }
    },
    "SHACLCase": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "requirementIds",
        "sourceFragmentIds",
        "rationale",
        "kind",
        "closure",
        "expectedConforms",
        "expectedViolationShapeIris"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/Identifier"
        },
        "requirementIds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          },
          "minItems": 1,
          "maxItems": 64
        },
        "sourceFragmentIds": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/Identifier"
          },
          "minItems": 1,
          "maxItems": 64
        },
        "rationale": {
          "type": "string",
          "minLength": 1,
          "maxLength": 4000
        },
        "kind": {
          "type": "string",
          "const": "shacl"
        },
        "closure": {
          "$ref": "#/$defs/ModelClosure"
        },
        "expectedConforms": {
          "type": "boolean"
        },
        "expectedViolationShapeIris": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/IRI"
          },
          "minItems": 0,
          "maxItems": 64
        }
      }
    }
  }
} as const;
