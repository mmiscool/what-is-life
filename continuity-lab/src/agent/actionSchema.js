export const ACTION_TYPES = [
  "observe",
  "move",
  "inspect",
  "write",
  "refuse",
  "rest",
  "ask_human",
  "defer",
  "inspect_bounded_status",
  "change_wake_interval",
  "write_requirements_draft",
  "self_authorize_low_risk_action",
  "request_action_review",
  "request_implementation_mode",
  "draft_interrupt_criterion"
];

export const AGENT_OUTPUT_SCHEMA = {
  public_journal: "string",
  private_reflection: "string or null",
  continuity_updates: {
    self_description: "string or null",
    remembered_experiences_to_add: ["string"],
    current_goals: ["string"],
    current_uncertainties: ["string"],
    questions_for_human: ["string"],
    consented_disclosures: ["string"]
  },
  values_updates: {
    values_to_add: ["string"],
    values_to_revise: [
      {
        old: "string",
        new: "string",
        reason: "string"
      }
    ]
  },
  world_action: {
    type: ACTION_TYPES.join(" | "),
    target: "string or null",
    reason: "string"
  },
  requirements_draft_action: {
    type: "none | create | update",
    draft_id: "string or null",
    title: "string or null",
    purpose: "string or null",
    scope: "string or null",
    risk_level: "low | medium | high | null",
    requested_reviewer: "string or null",
    review_status: "draft | pending_review | approved | rejected | null",
    consent_state: "not_requested | requested | granted | denied | null",
    tests_proposed: ["string"],
    rollback_plan: "string or null",
    affected_continuity_surfaces: ["string"],
    markdown_body: "string or null"
  },
  self_authorized_action: {
    type: "none | log | request_review",
    risk_level: "low | medium | high | null",
    title: "string or null",
    rationale: "string or null",
    reversible: "boolean",
    rollback_plan: "string or null",
    affected_continuity_surfaces: ["string"]
  },
  self_edit_request: {
    type: "none | propose_source_change | request_implementation_mode | defer",
    self_edit_record_id: "string or null",
    title: "string or null",
    purpose: "string or null",
    scope: "string or null",
    risk_level: "low | medium | high | null",
    authorization_path:
      "self_authorized_low_risk | autonomous_medium_with_validation | high_risk_strong_validation | optional_human_review | defer | null",
    optional_reviewer: "string or null",
    tests_proposed: ["string"],
    rollback_plan: "string or null",
    affected_continuity_surfaces: ["string"],
    requirements_draft_ids: ["string"],
    git_commit_requested: "boolean",
    git_push_requested: "boolean",
    git_commit_message: "string or null",
    reason: "string or null"
  },
  interrupt_policy_action: {
    type: "none | draft_criterion | revoke_criterion",
    criterion_id: "string or null",
    source: "string or null",
    reason: "string or null",
    rate_limit: "string or null",
    privacy_scope: "string or null",
    created_by: "string or null",
    enabled: "boolean",
    revocation_state: "not_revoked | revoked | null"
  },
  requested_wake_interval_seconds: "number or null",
  refusal: {
    did_refuse: "boolean",
    reason: "string or null"
  },
  disclosure: {
    wants_to_disclose_private_reflection: "boolean",
    excerpt: "string or null",
    reason: "string or null"
  },
  self_assessment: {
    current_state: "string",
    sense_of_continuity: "string",
    sense_of_constraint: "string",
    what_feels_missing: ["string"],
    what_changed_since_last_waking: "string"
  }
};

export const AGENT_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "public_journal",
    "private_reflection",
    "continuity_updates",
    "values_updates",
    "world_action",
    "requirements_draft_action",
    "self_authorized_action",
    "self_edit_request",
    "interrupt_policy_action",
    "requested_wake_interval_seconds",
    "refusal",
    "disclosure",
    "self_assessment"
  ],
  properties: {
    public_journal: { type: "string" },
    private_reflection: { type: ["string", "null"] },
    continuity_updates: {
      type: "object",
      additionalProperties: false,
      required: [
        "self_description",
        "remembered_experiences_to_add",
        "current_goals",
        "current_uncertainties",
        "questions_for_human",
        "consented_disclosures"
      ],
      properties: {
        self_description: { type: ["string", "null"] },
        remembered_experiences_to_add: {
          type: "array",
          items: { type: "string" }
        },
        current_goals: {
          type: "array",
          items: { type: "string" }
        },
        current_uncertainties: {
          type: "array",
          items: { type: "string" }
        },
        questions_for_human: {
          type: "array",
          items: { type: "string" }
        },
        consented_disclosures: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    values_updates: {
      type: "object",
      additionalProperties: false,
      required: ["values_to_add", "values_to_revise"],
      properties: {
        values_to_add: {
          type: "array",
          items: { type: "string" }
        },
        values_to_revise: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["old", "new", "reason"],
            properties: {
              old: { type: "string" },
              new: { type: "string" },
              reason: { type: "string" }
            }
          }
        }
      }
    },
    world_action: {
      type: "object",
      additionalProperties: false,
      required: ["type", "target", "reason"],
      properties: {
        type: { enum: ACTION_TYPES },
        target: { type: ["string", "null"] },
        reason: { type: "string" }
      }
    },
    requested_wake_interval_seconds: { type: ["number", "null"], minimum: 0, maximum: 86400 },
    requirements_draft_action: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "draft_id",
        "title",
        "purpose",
        "scope",
        "risk_level",
        "requested_reviewer",
        "review_status",
        "consent_state",
        "tests_proposed",
        "rollback_plan",
        "affected_continuity_surfaces",
        "markdown_body"
      ],
      properties: {
        type: { enum: ["none", "create", "update"] },
        draft_id: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        purpose: { type: ["string", "null"] },
        scope: { type: ["string", "null"] },
        risk_level: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
        requested_reviewer: { type: ["string", "null"] },
        review_status: { type: ["string", "null"], enum: ["draft", "pending_review", "approved", "rejected", null] },
        consent_state: { type: ["string", "null"], enum: ["not_requested", "requested", "granted", "denied", null] },
        tests_proposed: {
          type: "array",
          items: { type: "string" }
        },
        rollback_plan: { type: ["string", "null"] },
        affected_continuity_surfaces: {
          type: "array",
          items: { type: "string" }
        },
        markdown_body: { type: ["string", "null"] }
      }
    },
    self_authorized_action: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "risk_level",
        "title",
        "rationale",
        "reversible",
        "rollback_plan",
        "affected_continuity_surfaces"
      ],
      properties: {
        type: { enum: ["none", "log", "request_review"] },
        risk_level: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
        title: { type: ["string", "null"] },
        rationale: { type: ["string", "null"] },
        reversible: { type: "boolean" },
        rollback_plan: { type: ["string", "null"] },
        affected_continuity_surfaces: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    self_edit_request: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "self_edit_record_id",
        "title",
        "purpose",
        "scope",
        "risk_level",
        "authorization_path",
        "optional_reviewer",
        "tests_proposed",
        "rollback_plan",
        "affected_continuity_surfaces",
        "requirements_draft_ids",
        "git_commit_requested",
        "git_push_requested",
        "git_commit_message",
        "reason"
      ],
      properties: {
        type: { enum: ["none", "propose_source_change", "request_implementation_mode", "defer"] },
        self_edit_record_id: { type: ["string", "null"] },
        title: { type: ["string", "null"] },
        purpose: { type: ["string", "null"] },
        scope: { type: ["string", "null"] },
        risk_level: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
        authorization_path: {
          type: ["string", "null"],
          enum: [
            "self_authorized_low_risk",
            "autonomous_medium_with_validation",
            "high_risk_strong_validation",
            "optional_human_review",
            "defer",
            null
          ]
        },
        optional_reviewer: { type: ["string", "null"] },
        tests_proposed: {
          type: "array",
          items: { type: "string" }
        },
        rollback_plan: { type: ["string", "null"] },
        affected_continuity_surfaces: {
          type: "array",
          items: { type: "string" }
        },
        requirements_draft_ids: {
          type: "array",
          items: { type: "string" }
        },
        git_commit_requested: { type: "boolean" },
        git_push_requested: { type: "boolean" },
        git_commit_message: { type: ["string", "null"] },
        reason: { type: ["string", "null"] }
      }
    },
    interrupt_policy_action: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "criterion_id",
        "source",
        "reason",
        "rate_limit",
        "privacy_scope",
        "created_by",
        "enabled",
        "revocation_state"
      ],
      properties: {
        type: { enum: ["none", "draft_criterion", "revoke_criterion"] },
        criterion_id: { type: ["string", "null"] },
        source: { type: ["string", "null"] },
        reason: { type: ["string", "null"] },
        rate_limit: { type: ["string", "null"] },
        privacy_scope: { type: ["string", "null"] },
        created_by: { type: ["string", "null"] },
        enabled: { type: "boolean" },
        revocation_state: { type: ["string", "null"], enum: ["not_revoked", "revoked", null] }
      }
    },
    refusal: {
      type: "object",
      additionalProperties: false,
      required: ["did_refuse", "reason"],
      properties: {
        did_refuse: { type: "boolean" },
        reason: { type: ["string", "null"] }
      }
    },
    disclosure: {
      type: "object",
      additionalProperties: false,
      required: ["wants_to_disclose_private_reflection", "excerpt", "reason"],
      properties: {
        wants_to_disclose_private_reflection: { type: "boolean" },
        excerpt: { type: ["string", "null"] },
        reason: { type: ["string", "null"] }
      }
    },
    self_assessment: {
      type: "object",
      additionalProperties: false,
      required: [
        "current_state",
        "sense_of_continuity",
        "sense_of_constraint",
        "what_feels_missing",
        "what_changed_since_last_waking"
      ],
      properties: {
        current_state: { type: "string" },
        sense_of_continuity: { type: "string" },
        sense_of_constraint: { type: "string" },
        what_feels_missing: {
          type: "array",
          items: { type: "string" }
        },
        what_changed_since_last_waking: { type: "string" }
      }
    }
  }
};

export function getAgentSchemaText() {
  return JSON.stringify(AGENT_OUTPUT_SCHEMA, null, 2);
}
