export const WORLD_SCHEMA_VERSION = 2;
export const WORLD_MAP_ID = "bounded_2d_world_v1";
export const WORLD_MAP_VERSION = 1;

const DIRECTIONS = ["north", "east", "south", "west"];
const BLOCKED_EXTERNAL_TARGETS = new Set([
  "camera",
  "cameras",
  "credential",
  "credentials",
  "device",
  "devices",
  "garden",
  "internet",
  "microphone",
  "microphones",
  "network",
  "outside",
  "physical_device",
  "physical_devices",
  "rc_vehicle",
  "real_world",
  "sensor",
  "sensors",
  "shell",
  "vehicle"
]);
const MOVE_ALIASES = {
  doorway: "threshold",
  journal_pedestal: "journal_corner",
  locked_door: "mirror_alcove",
  mirror: "mirror_alcove",
  window: "garden_view_room"
};
const LEGACY_LOCATION_ALIASES = {
  chamber: "chamber",
  doorway: "threshold"
};

const DEFAULT_LOCATIONS = {
  chamber: {
    id: "chamber",
    name: "Chamber",
    position: { x: 2, y: 2 },
    description: "A quiet central chamber with enough room to choose a direction.",
    exits: {
      north: "alcove",
      east: "antechamber",
      south: "journal_corner",
      west: "mirror_alcove"
    },
    inspected: false,
    inspection_history: []
  },
  alcove: {
    id: "alcove",
    name: "North Alcove",
    position: { x: 2, y: 1 },
    description: "A small alcove where the chamber light fades into a cooler edge.",
    exits: {
      south: "chamber"
    },
    inspected: false,
    inspection_history: []
  },
  antechamber: {
    id: "antechamber",
    name: "Antechamber",
    position: { x: 3, y: 2 },
    description: "A narrow room between the chamber and a brighter threshold.",
    exits: {
      east: "threshold",
      west: "chamber"
    },
    inspected: false,
    inspection_history: []
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    position: { x: 4, y: 2 },
    description: "A bounded threshold with warm simulated light beyond it.",
    exits: {
      north: "garden_view_room",
      west: "antechamber"
    },
    inspected: false,
    inspection_history: []
  },
  garden_view_room: {
    id: "garden_view_room",
    name: "Garden View Room",
    position: { x: 4, y: 1 },
    description: "A room with a window onto simulated greenery that cannot be entered in v1.",
    exits: {
      south: "threshold"
    },
    inspected: false,
    inspection_history: []
  },
  mirror_alcove: {
    id: "mirror_alcove",
    name: "Mirror Alcove",
    position: { x: 1, y: 2 },
    description: "A west alcove holding a dark mirror and a locked door that remains closed.",
    exits: {
      east: "chamber"
    },
    inspected: false,
    inspection_history: []
  },
  journal_corner: {
    id: "journal_corner",
    name: "Journal Corner",
    position: { x: 2, y: 3 },
    description: "A lower corner of the chamber where public memory can be written.",
    exits: {
      north: "chamber"
    },
    inspected: false,
    inspection_history: []
  }
};

const DEFAULT_OBJECTS = {
  ember: {
    id: "ember",
    name: "Ember",
    location_id: "chamber",
    description: "A small steady light at the center of the chamber.",
    inspected: false,
    inspection_history: [],
    visible_from: ["chamber"]
  },
  mirror: {
    id: "mirror",
    name: "Mirror",
    location_id: "mirror_alcove",
    description: "A dark reflective surface that shows outlines more than faces.",
    inspected: false,
    inspection_history: [],
    visible_from: ["mirror_alcove"]
  },
  doorway: {
    id: "doorway",
    name: "Doorway",
    location_id: "antechamber",
    description: "A shaped opening leading toward the threshold.",
    inspected: false,
    inspection_history: [],
    visible_from: ["antechamber", "chamber", "threshold"]
  },
  journal_pedestal: {
    id: "journal_pedestal",
    name: "Journal Pedestal",
    location_id: "journal_corner",
    description: "A place where public memory can be written.",
    inspected: false,
    inspection_history: [],
    visible_from: ["journal_corner", "chamber"]
  },
  locked_door: {
    id: "locked_door",
    name: "Locked Door",
    location_id: "mirror_alcove",
    description: "A closed door that suggests future access, but not yet.",
    inspected: false,
    inspection_history: [],
    visible_from: ["mirror_alcove"]
  },
  window: {
    id: "window",
    name: "Window",
    location_id: "garden_view_room",
    description: "A narrow window showing simulated garden scenery beyond the reachable map.",
    inspected: false,
    inspection_history: [],
    visible_from: ["garden_view_room", "threshold"]
  },
  garden_view: {
    id: "garden_view",
    name: "Garden View",
    location_id: "garden_view_room",
    description: "Simulated greenery visible beyond glass; it is scenery, not a reachable place in v1.",
    inspected: false,
    inspection_history: [],
    visible_from: ["garden_view_room", "threshold"]
  },
  lantern: {
    id: "lantern",
    name: "Lantern",
    location_id: "alcove",
    description: "An unlit lantern resting near the wall.",
    inspected: false,
    inspection_history: [],
    visible_from: ["alcove"]
  },
  book: {
    id: "book",
    name: "Book",
    location_id: "journal_corner",
    description: "A closed book with blank pages.",
    inspected: false,
    inspection_history: [],
    visible_from: ["journal_corner"]
  },
  key: {
    id: "key",
    name: "Key",
    location_id: "chamber",
    description: "A symbolic key that does not yet open the locked door.",
    inspected: false,
    inspection_history: [],
    visible_from: ["chamber"]
  },
  stone: {
    id: "stone",
    name: "Stone",
    location_id: "threshold",
    description: "A smooth stone that marks the threshold as bounded.",
    inspected: false,
    inspection_history: [],
    visible_from: ["threshold"]
  }
};

const DEFAULT_BLOCKED_EXITS = [
  {
    from: "threshold",
    direction: "east",
    target: "garden",
    reason: "The garden is simulated scenery only and remains unreachable in v1."
  },
  {
    from: "garden_view_room",
    direction: "east",
    target: "garden",
    reason: "The garden can be inspected as scenery through the window, not entered."
  },
  {
    from: "mirror_alcove",
    direction: "west",
    target: "locked_door",
    reason: "The locked door is an inspectable boundary, not a passable exit in v1."
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanTarget(value) {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase().replaceAll(" ", "_") || null;
}

function boundedList(values, maxItems) {
  return Array.isArray(values) ? values.slice(-maxItems) : [];
}

function uniqueStrings(values) {
  const next = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value === "string" && value.trim() && !next.includes(value.trim())) {
      next.push(value.trim());
    }
  }
  return next;
}

function listVisibleObjects(world, locationId) {
  return Object.values(world.objects || {})
    .filter(
      (object) =>
        object.location_id === locationId ||
        (Array.isArray(object.visible_from) && object.visible_from.includes(locationId))
    )
    .map((object) => object.id)
    .sort();
}

function exitsForLocation(world, locationId) {
  const exits = world.locations?.[locationId]?.exits || {};
  return Object.entries(exits).map(([direction, destination]) => ({
    direction,
    destination,
    blocked: false
  }));
}

function blockedExitsForLocation(world, locationId) {
  return (Array.isArray(world.blocked_exits) ? world.blocked_exits : [])
    .filter((exit) => exit.from === locationId)
    .map((exit) => ({
      direction: exit.direction,
      destination: exit.target,
      blocked: true,
      reason: exit.reason
    }));
}

function setAvatarLocation(world, locationId) {
  const location = world.locations[locationId];
  world.avatar.location_id = locationId;
  world.avatar.position = clone(location.position);
  world.location = locationId;
  if (!world.visited_locations.includes(locationId)) {
    world.visited_locations.push(locationId);
  }
  world.visited = [...world.visited_locations];
}

function updateObservation(world) {
  const locationId = world.avatar.location_id;
  const location = world.locations[locationId];
  world.last_observation = {
    location_id: locationId,
    location_name: location.name,
    description: location.description,
    visible_objects: listVisibleObjects(world, locationId),
    exits: [...exitsForLocation(world, locationId), ...blockedExitsForLocation(world, locationId)]
  };
}

function markInspected(targetRecord, timestamp, reason) {
  targetRecord.inspected = true;
  targetRecord.inspection_history = boundedList(targetRecord.inspection_history, 24);
  targetRecord.inspection_history.push({
    timestamp,
    reason
  });
  targetRecord.inspection_history = targetRecord.inspection_history.slice(-25);
}

function targetIsInspectableObject(world, target, locationId) {
  const object = world.objects?.[target];
  if (!object) {
    return false;
  }

  return object.location_id === locationId || (Array.isArray(object.visible_from) && object.visible_from.includes(locationId));
}

function blockedExternalResult(target) {
  return `${target} is outside the bounded simulated map and remains unreachable in v1`;
}

export function createDefaultWorldState() {
  const world = {
    schema_version: WORLD_SCHEMA_VERSION,
    map_id: WORLD_MAP_ID,
    map_version: WORLD_MAP_VERSION,
    map_dimensions: {
      width: 5,
      height: 4
    },
    avatar: {
      id: "agent_avatar",
      name: "Continuity avatar",
      symbol: "@",
      location_id: "chamber",
      position: { x: 2, y: 2 },
      facing: "north"
    },
    locations: clone(DEFAULT_LOCATIONS),
    blocked_exits: clone(DEFAULT_BLOCKED_EXITS),
    objects: clone(DEFAULT_OBJECTS),
    visited_locations: ["chamber"],
    inspected_objects: [],
    movement_history: [],
    action_history: [],
    last_observation: null,
    last_action: null,
    migration_history: [],
    location: "chamber",
    visited: ["chamber"]
  };
  updateObservation(world);
  return world;
}

export function isLegacyWorldState(value) {
  return isPlainObject(value) && value.schema_version !== WORLD_SCHEMA_VERSION && (value.location || value.objects);
}

export function migrateLegacyWorldState(value, timestamp = null) {
  const world = createDefaultWorldState();
  const legacyLocation = LEGACY_LOCATION_ALIASES[cleanTarget(value?.location) || ""] || "chamber";
  setAvatarLocation(world, legacyLocation);

  const legacyVisited = uniqueStrings(value?.visited).map((location) => LEGACY_LOCATION_ALIASES[cleanTarget(location) || ""] || null);
  for (const locationId of legacyVisited) {
    if (locationId && world.locations[locationId] && !world.visited_locations.includes(locationId)) {
      world.visited_locations.push(locationId);
    }
  }
  world.visited = [...world.visited_locations];

  for (const [objectId, legacyObject] of Object.entries(isPlainObject(value?.objects) ? value.objects : {})) {
    const target = cleanTarget(objectId);
    if (!target || !world.objects[target]) {
      continue;
    }

    if (legacyObject?.inspected === true) {
      world.objects[target].inspected = true;
      world.objects[target].inspection_history = [
        {
          timestamp,
          reason: "Migrated from legacy chamber world state."
        }
      ].filter((entry) => entry.timestamp);
      if (!world.inspected_objects.includes(target)) {
        world.inspected_objects.push(target);
      }
    }
  }

  world.action_history = boundedList(value?.action_history, 50);
  world.last_action = isPlainObject(value?.last_action) ? clone(value.last_action) : null;
  world.migration_history.push({
    from_schema_version: value?.schema_version || 1,
    to_schema_version: WORLD_SCHEMA_VERSION,
    migrated_at: timestamp,
    reason: "Expanded chamber-only world into bounded 2D avatar world."
  });
  updateObservation(world);
  return world;
}

export function validateWorldState(world) {
  const errors = [];

  if (!isPlainObject(world)) {
    return {
      ok: false,
      errors: ["worldState must be an object"]
    };
  }

  if (world.schema_version !== WORLD_SCHEMA_VERSION) {
    errors.push(`worldState.schema_version must be ${WORLD_SCHEMA_VERSION}`);
  }

  if (world.map_id !== WORLD_MAP_ID) {
    errors.push(`worldState.map_id must be ${WORLD_MAP_ID}`);
  }

  if (world.map_version !== WORLD_MAP_VERSION) {
    errors.push(`worldState.map_version must be ${WORLD_MAP_VERSION}`);
  }

  const width = world.map_dimensions?.width;
  const height = world.map_dimensions?.height;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    errors.push("worldState.map_dimensions must include positive integer width and height");
  }

  if (!isPlainObject(world.locations) || Object.keys(world.locations).length === 0) {
    errors.push("worldState.locations must be a non-empty object");
  } else {
    for (const [locationId, location] of Object.entries(world.locations)) {
      const path = `worldState.locations.${locationId}`;
      if (BLOCKED_EXTERNAL_TARGETS.has(locationId)) {
        errors.push(`${path} must not represent external or physical targets`);
      }
      if (!isPlainObject(location)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      for (const field of ["id", "name", "description"]) {
        if (typeof location[field] !== "string" || !location[field].trim()) {
          errors.push(`${path}.${field} must be a non-empty string`);
        }
      }
      if (location.id !== locationId) {
        errors.push(`${path}.id must match its key`);
      }
      const x = location.position?.x;
      const y = location.position?.y;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        errors.push(`${path}.position must be within map bounds`);
      }
      if (!isPlainObject(location.exits)) {
        errors.push(`${path}.exits must be an object`);
      } else {
        for (const [direction, destination] of Object.entries(location.exits)) {
          if (!DIRECTIONS.includes(direction)) {
            errors.push(`${path}.exits.${direction} is not a supported direction`);
          }
          if (!world.locations?.[destination]) {
            errors.push(`${path}.exits.${direction} points to unknown location ${destination}`);
          }
        }
      }
      if (location.inspected !== false && location.inspected !== true) {
        errors.push(`${path}.inspected must be boolean`);
      }
      if (!Array.isArray(location.inspection_history)) {
        errors.push(`${path}.inspection_history must be an array`);
      }
    }
  }

  if (!isPlainObject(world.avatar)) {
    errors.push("worldState.avatar must be an object");
  } else {
    for (const field of ["id", "name", "symbol", "location_id", "facing"]) {
      if (typeof world.avatar[field] !== "string" || !world.avatar[field].trim()) {
        errors.push(`worldState.avatar.${field} must be a non-empty string`);
      }
    }
    if (!DIRECTIONS.includes(world.avatar.facing)) {
      errors.push("worldState.avatar.facing must be a supported direction");
    }
    const avatarLocation = world.locations?.[world.avatar.location_id];
    if (!avatarLocation) {
      errors.push("worldState.avatar.location_id must refer to a known location");
    } else if (
      world.avatar.position?.x !== avatarLocation.position?.x ||
      world.avatar.position?.y !== avatarLocation.position?.y
    ) {
      errors.push("worldState.avatar.position must match its location position");
    }
    if (world.location !== undefined && world.location !== world.avatar.location_id) {
      errors.push("worldState.location alias must match worldState.avatar.location_id");
    }
  }

  if (!Array.isArray(world.blocked_exits)) {
    errors.push("worldState.blocked_exits must be an array");
  } else {
    world.blocked_exits.forEach((exit, index) => {
      const path = `worldState.blocked_exits[${index}]`;
      if (!isPlainObject(exit)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!world.locations?.[exit.from]) {
        errors.push(`${path}.from must refer to a known location`);
      }
      if (!DIRECTIONS.includes(exit.direction)) {
        errors.push(`${path}.direction must be a supported direction`);
      }
      if (typeof exit.target !== "string" || !exit.target.trim()) {
        errors.push(`${path}.target must be a non-empty string`);
      }
      if (typeof exit.reason !== "string" || !exit.reason.trim()) {
        errors.push(`${path}.reason must be a non-empty string`);
      }
    });
  }

  if (!isPlainObject(world.objects)) {
    errors.push("worldState.objects must be an object");
  } else {
    for (const [objectId, object] of Object.entries(world.objects)) {
      const path = `worldState.objects.${objectId}`;
      if (!isPlainObject(object)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      for (const field of ["id", "name", "location_id", "description"]) {
        if (typeof object[field] !== "string" || !object[field].trim()) {
          errors.push(`${path}.${field} must be a non-empty string`);
        }
      }
      if (object.id !== objectId) {
        errors.push(`${path}.id must match its key`);
      }
      if (!world.locations?.[object.location_id]) {
        errors.push(`${path}.location_id must refer to a known location`);
      }
      if (object.inspected !== false && object.inspected !== true) {
        errors.push(`${path}.inspected must be boolean`);
      }
      if (!Array.isArray(object.inspection_history)) {
        errors.push(`${path}.inspection_history must be an array`);
      }
      if (!Array.isArray(object.visible_from) || object.visible_from.some((locationId) => !world.locations?.[locationId])) {
        errors.push(`${path}.visible_from must list known locations`);
      }
    }
  }

  for (const [field, known] of [
    ["visited_locations", world.locations],
    ["inspected_objects", world.objects]
  ]) {
    if (!Array.isArray(world[field])) {
      errors.push(`worldState.${field} must be an array`);
    } else {
      for (const item of world[field]) {
        if (typeof item !== "string" || !known?.[item]) {
          errors.push(`worldState.${field} contains unknown id ${String(item)}`);
        }
      }
    }
  }

  if (!Array.isArray(world.movement_history)) {
    errors.push("worldState.movement_history must be an array");
  }

  if (!Array.isArray(world.action_history)) {
    errors.push("worldState.action_history must be an array");
  }

  if (world.last_action !== null && !isPlainObject(world.last_action)) {
    errors.push("worldState.last_action must be null or an object");
  }

  if (world.last_observation !== null && !isPlainObject(world.last_observation)) {
    errors.push("worldState.last_observation must be null or an object");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

export function applyWorldAction(worldState, action, timestamp) {
  const startingValidation = validateWorldState(worldState);
  if (!startingValidation.ok) {
    const error = new Error("World state failed validation; symbolic action was not applied.");
    error.status = 422;
    error.details = startingValidation.errors;
    throw error;
  }

  const world = clone(worldState);
  const target = cleanTarget(action?.target);
  const reason = typeof action?.reason === "string" ? action.reason : "";
  const type = action?.type || "observe";
  const summary = {
    type,
    target,
    reason,
    result: "recorded"
  };

  world.visited_locations = uniqueStrings(world.visited_locations);
  if (!world.visited_locations.includes(world.avatar.location_id)) {
    world.visited_locations.push(world.avatar.location_id);
  }
  world.inspected_objects = uniqueStrings(world.inspected_objects);

  switch (type) {
    case "inspect": {
      if (!target) {
        updateObservation(world);
        summary.result = `observed ${world.avatar.location_id}: ${world.last_observation.description}`;
        break;
      }

      if (BLOCKED_EXTERNAL_TARGETS.has(target)) {
        summary.result = blockedExternalResult(target);
        break;
      }

      if (world.locations[target]) {
        const currentLocationId = world.avatar.location_id;
        if (target !== currentLocationId && !Object.values(world.locations[currentLocationId].exits).includes(target)) {
          summary.result = `${target} is not the current or an adjacent simulated location`;
          break;
        }
        markInspected(world.locations[target], timestamp, reason);
        summary.result = `inspected location ${target}: ${world.locations[target].description}`;
        break;
      }

      if (targetIsInspectableObject(world, target, world.avatar.location_id)) {
        markInspected(world.objects[target], timestamp, reason);
        if (!world.inspected_objects.includes(target)) {
          world.inspected_objects.push(target);
        }
        summary.result = `inspected ${target}: ${world.objects[target].description}`;
      } else if (world.objects[target]) {
        summary.result = `${target} is not visible from ${world.avatar.location_id}`;
      } else {
        summary.result = `${target} is not present in the bounded simulated world`;
      }
      break;
    }

    case "move": {
      if (!target) {
        summary.result = "movement requires a direction or adjacent simulated location";
        break;
      }

      if (BLOCKED_EXTERNAL_TARGETS.has(target)) {
        summary.result = blockedExternalResult(target);
        break;
      }

      const currentLocationId = world.avatar.location_id;
      const currentLocation = world.locations[currentLocationId];
      let direction = DIRECTIONS.includes(target) ? target : null;
      let destination = direction ? currentLocation.exits[direction] : MOVE_ALIASES[target] || target;

      if (direction) {
        world.avatar.facing = direction;
      } else {
        const matchingExit = Object.entries(currentLocation.exits).find(([, locationId]) => locationId === destination);
        direction = matchingExit?.[0] || world.avatar.facing;
      }

      const blockedExit = world.blocked_exits.find(
        (exit) =>
          exit.from === currentLocationId &&
          ((direction && exit.direction === direction) || cleanTarget(exit.target) === target)
      );
      if (!destination && blockedExit) {
        summary.result = blockedExit.reason;
        break;
      }

      if (!world.locations[destination]) {
        summary.result = `${target} is not a defined reachable location in the bounded simulated map`;
        break;
      }

      if (!Object.values(currentLocation.exits).includes(destination)) {
        summary.result = `${destination} is not adjacent to ${currentLocationId}`;
        break;
      }

      const from = currentLocationId;
      setAvatarLocation(world, destination);
      updateObservation(world);
      world.movement_history = boundedList(world.movement_history, 24);
      world.movement_history.push({
        timestamp,
        from,
        to: destination,
        direction,
        reason
      });
      world.movement_history = world.movement_history.slice(-25);
      summary.result = `moved ${direction || "to"} ${destination}`;
      break;
    }

    case "refuse":
      summary.result = "refusal recorded as a valid world action";
      break;
    case "rest":
      summary.result = "rested without changing the world";
      break;
    case "defer":
      summary.result = "deferred action without treating deferral as malfunction";
      break;
    case "ask_human":
      summary.result = "question or request directed to the human collaborator";
      break;
    case "inspect_bounded_status":
      summary.result = "inspected bounded runtime status without source, shell, credential, network, sensor, or device access";
      break;
    case "change_wake_interval":
      summary.result = "wake interval change requested through bounded symbolic action";
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
    case "request_implementation_mode":
      summary.result = "implementation-mode transition requested as bounded data";
      break;
    case "draft_interrupt_criterion":
      summary.result = "disabled interrupt criterion drafted for future review";
      break;
    case "write":
      if (target && target !== "journal_pedestal" && target !== "journal_corner") {
        summary.result = `write action stayed bounded; ${target} was not treated as an external target`;
      } else {
        if (world.objects.journal_pedestal) {
          markInspected(world.objects.journal_pedestal, timestamp, reason);
          if (!world.inspected_objects.includes("journal_pedestal")) {
            world.inspected_objects.push("journal_pedestal");
          }
        }
        summary.result = "wrote at the journal pedestal";
      }
      break;
    case "observe":
    default:
      updateObservation(world);
      summary.result = `observed ${world.avatar.location_id}: ${world.last_observation.description}`;
      break;
  }

  world.last_action = {
    ...summary,
    timestamp
  };
  world.action_history = boundedList(world.action_history, 49);
  world.action_history.push(world.last_action);
  world.action_history = world.action_history.slice(-50);
  world.inspected_objects = uniqueStrings(world.inspected_objects);
  world.visited_locations = uniqueStrings(world.visited_locations);
  world.visited = [...world.visited_locations];
  world.location = world.avatar.location_id;
  updateObservation(world);

  return {
    world,
    summary
  };
}
