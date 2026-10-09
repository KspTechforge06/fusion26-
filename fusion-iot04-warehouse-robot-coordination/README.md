# Swarm Coordination for Warehouse Robot Fleets

**FUSION 2K26 · Problem Statement IOT-04**  
**Organization:** Amazon Robotics  
**Team:** SideQuest

> Deterministic warehouse robot fleet simulation exploring A* path planning, time-aware reservations, conflict avoidance, and disruption-aware replanning.

## Project overview

Warehouse robot fleets must coordinate shared routes and tasks while responding to congestion, blocked corridors, robot failures, and changing priorities. This project will model those behaviors in a deterministic grid-based simulation.

The repository is being prepared for development. **The application is not implemented yet**, and no simulation, UI, benchmark, or runtime demo is currently available.

## Proposed solution

The planned prototype will combine individual A* pathfinding with prioritized, time-aware coordination. Robots will plan over a grid while reserving future vertices and directed edges. Conflict checks will prevent same-cell occupancy and edge swaps, while selective replanning will respond to disruptions. Eligible unfinished tasks may be reassigned when a robot fails or priorities change.

## Planned capabilities

- Load and validate Moving AI octile-format warehouse maps without modifying the source files.
- Plan four-directional routes with A* and Manhattan distance.
- Coordinate multiple robots with time-indexed vertex and edge reservations.
- Detect and prevent vertex conflicts and edge-swap conflicts.
- Support safe wait actions and selective replanning.
- Model blocked cells, robot failures, priority changes, and unfinished-task reassignment.
- Provide deterministic simulation ticks and a visual grid-based simulation.
- Report completion, distance, timing, replanning, recovery, conflict, failure, and progress metrics.

These are **planned features**, not implemented features.

## Proposed technical architecture

The implementation is expected to separate the following responsibilities:

- **Map data:** immutable static obstacles and validated cells, with dynamic blocks as an overlay.
- **Pathfinding:** spatial A* and reservation-aware time-expanded search.
- **Coordination:** deterministic priority ordering, reservations, conflict checks, and replanning.
- **Simulation:** event processing, tick sequencing, movement validation, and atomic movement commits.
- **Robot and task state:** lifecycle, assignments, goals, priorities, and progress.
- **Metrics:** measurements derived from simulation events and state transitions.
- **UI:** visualization and controls that do not make movement-safety decisions.

The programming language, UI framework, persistence format, and detailed runtime configuration remain open implementation decisions.

## Planned evaluation metrics

The planned evaluation will track tasks completed and completion rate, executed distance, makespan and per-task delivery time, replanning and recovery time, prevented vertex and edge-swap conflicts, invalid moves, failed or unassigned tasks, and no-progress events. Committed safety violations must remain zero.

No benchmark results or performance measurements are reported because the application has not been implemented or run.

## Development status

**Current status: repository foundation / planning phase.**

The workspace currently contains 33 validated `.map` environment files and project specification and audit material under `reports/`. Implementation, dependencies, automated tests, visualization, and runtime evaluation will be added in later development steps.

## Repository structure

```text
.
├── README.md
├── .gitignore
├── *.map                         # Existing supplied environment maps
└── reports/
    ├── STEP_01_AUDIT.md
    ├── STEP_02_AUDIT.md
    ├── STEP_02_SPECIFICATION.md
    └── STEP_02_1_REVIEW.md
```

The maps remain at the project root because the existing audit reports refer to those paths. A future relocation should update and verify all references rather than moving them blindly. Source and test directories will be introduced when implementation begins; empty placeholders are intentionally not created.

## Getting started

There is no runnable application or dependency manifest yet, so there are no setup or execution commands to run at this stage. Once implementation begins, the repository will document the selected runtime, dependency installation, simulation commands, test commands, and visualization workflow here.

## References

- [`reports/STEP_01_AUDIT.md`](reports/STEP_01_AUDIT.md) — initial environment and map audit.
- [`reports/STEP_02_AUDIT.md`](reports/STEP_02_AUDIT.md) — independent audit verification.
- [`reports/STEP_02_SPECIFICATION.md`](reports/STEP_02_SPECIFICATION.md) — simulation design specification.
- [`reports/STEP_02_1_REVIEW.md`](reports/STEP_02_1_REVIEW.md) — coordination specification gap review.

The local materials identify the maps as Moving AI octile maps but do not include verified redistribution terms. No external citation or licensing claim is made here.

## Team

- **Prajwal Kamble** — Team Leader
- **Aadhya Khajuria**
- **Anay Gawate**
- **Lakshya Jain**

## License and map attribution

No `LICENSE` file is included at this stage. The available local materials do not establish the appropriate license for this project or verified redistribution terms for the supplied third-party map files. Those terms should be confirmed before publishing the repository or redistributing the maps.
