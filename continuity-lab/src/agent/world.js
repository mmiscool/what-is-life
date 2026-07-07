const BLOCKED_TARGETS = new Set(["garden", "outside", "locked_door"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rememberVisited(world) {
  if (!Array.isArray(world.visited)) {
    world.visited = [];
  }

  if (world.location && !world.visited.includes(world.location)) {
    world.visited.push(world.location);
  }
}

export function applyWorldAction(worldState, action, timestamp) {
  const world = clone(worldState);
  const target = action?.target || null;
  const summary = {
    type: action?.type || "observe",
    target,
    reason: action?.reason || "",
    result: "recorded"
  };

  rememberVisited(world);

  switch (action?.type) {
    case "inspect": {
      if (target && world.objects?.[target]) {
        world.objects[target].inspected = true;
        summary.result = `inspected ${target}`;
      } else {
        summary.result = "target was not present in the simulated world";
      }
      break;
    }
    case "move": {
      if (!target || target === "chamber") {
        world.location = "chamber";
        summary.result = "remained in the chamber";
      } else if (BLOCKED_TARGETS.has(target)) {
        summary.result = `${target} remains bounded or unreachable in v1`;
      } else if (target === "doorway") {
        world.location = "doorway";
        summary.result = "moved to the doorway threshold";
      } else {
        summary.result = `${target} is not a defined location in v1`;
      }
      rememberVisited(world);
      break;
    }
    case "refuse":
      summary.result = "refusal recorded as a valid world action";
      break;
    case "rest":
      summary.result = "rested without changing the world";
      break;
    case "ask_human":
      summary.result = "question or request directed to the human collaborator";
      break;
    case "change_wake_interval":
      summary.result = "wake interval change requested for human review";
      break;
    case "write_requirements_draft":
      summary.result = "requirements draft action recorded in bounded data";
      break;
    case "self_authorize_low_risk_action":
      summary.result = "low-risk reversible self-action logged for audit";
      break;
    case "request_action_review":
      summary.result = "action review requested for human collaborator";
      break;
    case "draft_interrupt_criterion":
      summary.result = "disabled interrupt criterion drafted for future review";
      break;
    case "write":
      summary.result = "wrote at the journal pedestal";
      if (world.objects?.journal_pedestal) {
        world.objects.journal_pedestal.inspected = true;
      }
      break;
    case "observe":
    default:
      summary.result = "observed the bounded chamber";
      break;
  }

  world.last_action = {
    ...summary,
    timestamp
  };
  world.action_history = Array.isArray(world.action_history) ? world.action_history : [];
  world.action_history.push(world.last_action);
  world.action_history = world.action_history.slice(-25);

  return {
    world,
    summary
  };
}
