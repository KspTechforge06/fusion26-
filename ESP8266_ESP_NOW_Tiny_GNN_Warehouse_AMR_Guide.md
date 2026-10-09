# Implementing a Tiny GNN on ESP8266 with ESP-NOW

## Warehouse AMR Fleet Coordination --- Hackathon Implementation Guide

**Project:** decentralized warehouse robot fleet with congestion-aware
movement, local conflict handling, and task recovery after a robot
failure\
**Target hardware:** ESP8266 NodeMCU / ESP-12E-class boards\
**Communication:** ESP-NOW peer-to-peer messages\
**Training:** laptop (Python + PyTorch)\
**Inference:** each ESP8266 runs its own small, exported neural network\
**Visualization:** laptop warehouse simulator/dashboard

------------------------------------------------------------------------

## 1. Goal and scope

Build a small, credible proof of concept in which every robot
controller:

1.  Maintains its own local state and goal.
2.  Broadcasts its state and intended next move over ESP-NOW.
3.  Receives nearby robots' states.
4.  Runs a tiny message-passing neural network (GNN-style policy)
    locally.
5.  Applies a deterministic safety filter before accepting a proposed
    move.
6.  Stops safely or falls back to a conventional policy when data is
    stale or the proposed action is unsafe.

The laptop may display the simulation, log events, and calculate
metrics. It must **not choose each robot's movement** if the project is
being presented as decentralized.

### Important distinction

A small neural network that consumes neighbor features is not
automatically a graph neural network. To justify the GNN description,
the implementation must explicitly aggregate representations from a
variable set of neighboring robots using a permutation-invariant
operation such as mean or sum aggregation. Train the model offline and
deploy the same architecture and learned parameters on the boards. If
the weights are manually chosen, describe the result as *GNN-inspired*,
not as a trained GNN.

### What this guide does not claim

-   ESP8266 is not a good platform for training the network. Train on a
    laptop.
-   A GNN does not guarantee collision avoidance. Use an independent
    safety layer.
-   ESP-NOW delivery is not guaranteed. Handle stale messages, duplicate
    messages, and packet loss.
-   ESP-NOW does not itself provide a global, reliable reservation
    table. A distributed reservation protocol needs additional design
    and testing.
-   A single board per robot is a hardware architecture; the initial
    hackathon demo can represent robot movement in a laptop simulator
    while boards make local decisions.

------------------------------------------------------------------------

## 2. System architecture

``` text
              Laptop (not a movement controller)
       +---------------------------------------------+
       | 2D warehouse simulator / dashboard          |
       | Scenario injection, logs, metrics, replay   |
       +----------------------+----------------------+
                              |
                    optional telemetry bridge
                              |
       ESP-NOW peer-to-peer network on one Wi-Fi channel
             /                |                 \
+------------------+ +------------------+ +------------------+
| ESP8266 Robot A  | | ESP8266 Robot B  | | ESP8266 Robot C  |
| local features   | | local features   | | local features   |
| neighbor table   | | neighbor table   | | neighbor table   |
| tiny GNN         | | tiny GNN         | | tiny GNN         |
| safety filter    | | safety filter    | | safety filter    |
| local action     | | local action     | | local action     |
+------------------+ +------------------+ +------------------+
```

### Per-robot loop

1.  Read/update local state.
2.  Send a compact state packet.
3.  Process packets into a neighbor table.
4.  Expire neighbors whose packets have become stale.
5.  Build normalized self and neighbor features.
6.  Run the GNN.
7.  Mask unsafe actions and select the best remaining action.
8.  Publish the intended action in the next packet.
9.  Execute one movement step, or update the simulator through a
    telemetry channel.

**Hackathon recommendation:** first use ESP-NOW between two or three
boards and have each board print its chosen action over USB serial. Add
the 2D simulator after packet exchange and inference are stable.

------------------------------------------------------------------------

## 3. Hardware and tools

### Required

-   2 or more ESP8266 NodeMCU boards
-   USB data cables
-   Laptop
-   Arduino IDE or PlatformIO
-   Python 3
-   PyTorch and NumPy for offline training/data generation
-   A 2D simulator, such as Python + Pygame, if time allows

### Optional

-   Motor driver and motors
-   Battery monitor
-   A separate laptop-side serial bridge for visualization

Do not power motors from an ESP8266 GPIO. Use a suitable motor driver
and separate motor supply with a shared ground where required. Keep the
first demo on USB/serial before adding physical movement.

### Install the ESP8266 Arduino core

Follow the current installation instructions and examples in the
official project:

-   https://github.com/esp8266/Arduino
-   ESP8266 Arduino core documentation:
    https://arduino-esp8266.readthedocs.io/

Select the correct board in the IDE, select its serial port, upload a
Blink sketch, and confirm serial output before starting ESP-NOW work.

### ESP-NOW compatibility note

ESP-NOW APIs differ between ESP8266 and ESP32, and callback signatures
can differ across ESP8266 Arduino core versions. Use the ESP8266 core's
own ESP-NOW examples and headers as the source of truth. Do not paste
ESP32-only callback signatures into an ESP8266 project. Both peers must
use compatible channel settings. Check the API and examples for the
exact installed core version before integrating the full application.

Useful references:

-   ESP8266 Arduino core repository: https://github.com/esp8266/Arduino
-   ESP8266 SDK ESP-NOW header (reference; the installed core may expose
    its own wrapper):
    https://github.com/esp8266/Arduino/blob/master/tools/sdk/include/espnow.h

------------------------------------------------------------------------

## 4. Define the robot graph

Each robot is a node. A robot's neighbors are the other robots whose
latest valid messages are relevant to local coordination---for example,
robots within a grid distance of 5 cells, or simply the most recent 4
valid peers for a small demo.

For the first implementation, use a fixed maximum of **4 neighbors**.
This keeps RAM usage predictable while still allowing a variable number
of valid neighbors.

### Suggested node features

Use 6 normalized input features:

  -----------------------------------------------------------------------------------
  Index             Feature           Suggested range   Meaning
  ----------------- ----------------- ----------------- -----------------------------
  0                 Relative goal X   -1 to +1          `(goalX - x) / maxDistance`

  1                 Relative goal Y   -1 to +1          `(goalY - y) / maxDistance`

  2                 Battery fraction  0 to 1            `batteryPercent / 100`

  3                 Task priority     0 to 1            normalized priority

  4                 Local congestion  0 to 1            fraction or score for
                                                        blocked/busy nearby cells

  5                 Robot status      0 to 1            e.g. 1 for blocked, 0
                                                        otherwise; use a consistent
                                                        definition
  -----------------------------------------------------------------------------------

Use the same feature ordering, normalization, and units in the training
code and embedded C++ code. Do not feed raw grid coordinates into a
model trained on normalized relative coordinates.

### Neighbor messages should include state, not just neural features

A compact wire packet should include identity, sequence number,
position, goal, battery, priority, status, and intended next action. The
receiving robot can derive normalized features from these fields.

------------------------------------------------------------------------

## 5. ESP-NOW message design

Start with a small fixed-size binary structure. Both firmware builds
must use the exact same field order and types.

``` cpp
#pragma pack(push, 1)
struct RobotPacket {
  uint8_t  protocolVersion;
  uint8_t  robotId;
  uint16_t sequence;

  int16_t  x;
  int16_t  y;
  int16_t  goalX;
  int16_t  goalY;

  uint8_t  batteryPercent; // 0..100
  uint8_t  priority;       // choose and document a range, e.g. 0..10
  uint8_t  status;         // 0=working, 1=waiting, 2=blocked, 3=failed
  uint8_t  nextAction;     // 0=up,1=down,2=left,3=right,4=wait
};
#pragma pack(pop)
```

Keep the packet well below the ESP-NOW payload limit for the installed
SDK. Avoid sending strings, JSON, or a full map on every update. Add a
protocol version so incompatible firmware can reject unexpected packets.

### Packet-handling rules

-   Validate packet length before copying or interpreting it.
-   Ignore packets with an invalid robot ID or unsupported protocol
    version.
-   Track the most recent sequence number per robot.
-   Ignore duplicate or old packets.
-   Store the local receive timestamp when a valid packet arrives.
-   Expire neighbor records after a timeout chosen through testing (for
    example, 1--2 seconds for a slow demo).
-   Never assume a missing packet means a robot has failed. It may be
    out of range or suffering packet loss.
-   For a physical robot, fail safe when communication becomes stale.

**ESP-NOW callback rule:** callbacks should do minimal work. Copy the
packet into a small queue or latest-packet buffer and return. Do not run
GNN inference, print large logs, or perform path planning inside the
radio callback. Process packets in the main loop.

------------------------------------------------------------------------

## 6. Bring up ESP-NOW before adding the GNN

### Stage A --- verify boards

On every board: 1. Upload a basic sketch. 2. Print the board's MAC
address using the API available in the installed ESP8266 core. 3.
Confirm each board has a unique ID configured in firmware. 4. Record the
MAC addresses.

### Stage B --- choose a channel

ESP-NOW peers need compatible radio channel settings. For the first
demo, configure all boards to the same fixed channel and avoid changing
it at runtime. If using a Wi-Fi access point as well, account for the
AP's channel: the ESP8266 radio generally cannot remain on an unrelated
channel for ESP-NOW and AP traffic simultaneously.

### Stage C --- start with broadcast

Broadcast can simplify initial discovery if supported by the installed
ESP8266 core/API. It is useful for a small demo but is not authenticated
by itself and should not be treated as a secure network.

Then test unicast peer communication if you want explicit peer lists.
Follow the exact ESP8266 core example for initialization, peer
registration, send calls, and receive callback signatures.

### Stage D --- verify before proceeding

A minimal communication test should prove: - A sends a packet and B
receives it. - B sends a packet and A receives it. - Packet sequence
numbers increase. - Invalid-length or unexpected packets are ignored. -
The system continues operating when one board is powered off.

Do not proceed to GNN integration until these tests pass.

------------------------------------------------------------------------

## 7. The tiny message-passing network

Use a small network first:

-   Node input: 6 features
-   Hidden size: 8
-   Output: 5 action scores
-   Maximum neighbors: 4
-   Actions: up, down, left, right, wait

This is small enough to implement with fixed-size arrays. Float32
inference is the easiest starting point; measure actual runtime and
memory before considering quantization.

### Mathematical structure

Encode each node:

\[ h_i = `\operatorname{ReLU}`{=tex}(W\_{in}x_i + b\_{in}) \]

Aggregate neighbor representations using a mean:

\[ m_i = `\frac{1}{|N(i)|}`{=tex}`\sum`{=tex}\_{j`\in `{=tex}N(i)}h_j \]

If there are no valid neighbors, define (m_i=0).

Combine local and neighbor information:

\[ z_i = `\operatorname{ReLU}`{=tex}(W_s h_i + W_n m_i + b) \]

Produce five action scores:

\[ q_i = W_o z_i + b_o \]

The action with the highest score is the model's preferred action. Apply
the safety filter before executing it.

Mean aggregation is permutation-invariant: reordering neighbor packets
should not change the aggregate. That is an important property for
graph-based models.

------------------------------------------------------------------------

## 8. Embedded C++ inference scaffold

Create `tiny_gnn.h`. This code shows the required matrix operations and
fixed memory use. The all-zero arrays are **placeholders only**; they
are not a working trained policy.

``` cpp
#pragma once
#include <Arduino.h>

constexpr int INPUTS = 6;
constexpr int HIDDEN = 8;
constexpr int ACTIONS = 5;
constexpr int MAX_NEIGHBORS = 4;

struct Features {
  float x[INPUTS];
};

struct Scores {
  float q[ACTIONS];
};

// Replace these arrays with exported trained parameters.
// Shapes: W_IN[8][6], W_SELF[8][8],
// W_NEIGHBOR[8][8], W_OUT[5][8].
static const float W_IN[HIDDEN][INPUTS] = {};
static const float B_IN[HIDDEN] = {};
static const float W_SELF[HIDDEN][HIDDEN] = {};
static const float W_NEIGHBOR[HIDDEN][HIDDEN] = {};
static const float B_HIDDEN[HIDDEN] = {};
static const float W_OUT[ACTIONS][HIDDEN] = {};
static const float B_OUT[ACTIONS] = {};

inline float relu(float v) {
  return v > 0.0f ? v : 0.0f;
}

inline void encode(const Features &f, float h[HIDDEN]) {
  for (int i = 0; i < HIDDEN; ++i) {
    float sum = B_IN[i];
    for (int j = 0; j < INPUTS; ++j)
      sum += W_IN[i][j] * f.x[j];
    h[i] = relu(sum);
  }
}

inline Scores inferGNN(
    const Features &self,
    const Features neighbors[MAX_NEIGHBORS],
    int neighborCount) {

  float hSelf[HIDDEN] = {};
  float aggregate[HIDDEN] = {};
  float combined[HIDDEN] = {};

  encode(self, hSelf);

  if (neighborCount < 0) neighborCount = 0;
  if (neighborCount > MAX_NEIGHBORS)
    neighborCount = MAX_NEIGHBORS;

  for (int n = 0; n < neighborCount; ++n) {
    float hNeighbor[HIDDEN] = {};
    encode(neighbors[n], hNeighbor);
    for (int k = 0; k < HIDDEN; ++k)
      aggregate[k] += hNeighbor[k];
  }

  if (neighborCount > 0) {
    for (int k = 0; k < HIDDEN; ++k)
      aggregate[k] /= neighborCount;
  }

  for (int i = 0; i < HIDDEN; ++i) {
    float sum = B_HIDDEN[i];
    for (int j = 0; j < HIDDEN; ++j) {
      sum += W_SELF[i][j] * hSelf[j];
      sum += W_NEIGHBOR[i][j] * aggregate[j];
    }
    combined[i] = relu(sum);
  }

  Scores out{};
  for (int a = 0; a < ACTIONS; ++a) {
    float sum = B_OUT[a];
    for (int j = 0; j < HIDDEN; ++j)
      sum += W_OUT[a][j] * combined[j];
    out.q[a] = sum;
  }
  return out;
}
```

### Architecture consistency warning

The Python training model must use precisely the same architecture as
this C++ code. If your training model uses separate biases for the self
and neighbor transformations, your C++ model must preserve those
separate biases. Do not silently merge them during export.

For safety and reproducibility, test several fixed inputs on both Python
and C++ and compare all five output scores within a small floating-point
tolerance before connecting the policy to robot motion.

------------------------------------------------------------------------

## 9. Train the network offline

### Suggested first training strategy: imitation learning

Do not begin with reinforcement learning during a 24-hour hackathon.
Generate randomized warehouse states and use a conventional teacher
policy to label safe actions. Train the GNN to imitate those labels.

A teacher may use: - A\* for a route toward the goal. - A reservation
table or simple priority rules to avoid conflicts. - Congestion costs to
discourage busy corridors. - Explicit labels for waiting or yielding
when necessary.

The model learns a local approximation to the teacher from self and
neighbor features. This is practical but has a limitation: it cannot
reliably learn to avoid an obstacle or reason about a route if the
required map/obstacle information is absent from its inputs. Include
local blocked-cell or candidate-action safety information if the network
is expected to choose around obstacles.

### Training data

Generate examples containing: - Static and randomized warehouse maps. -
Different robot counts and start/goal locations. - Two robots
approaching the same cell. - Congestion and blocked corridors. - A
high-priority order. - A robot that stops responding. - No-neighbor and
stale-neighbor conditions.

Split training and evaluation by scenario or map, not merely by randomly
splitting nearly identical rows. This gives a more meaningful test of
generalization.

### Example PyTorch model

Save as `train_gnn.py`. This is a model definition, not a complete
training pipeline; you still need to create labeled examples, a dataset,
a loss, an optimizer, and an evaluation loop.

``` python
import torch
import torch.nn as nn
import torch.nn.functional as F

INPUTS = 6
HIDDEN = 8
ACTIONS = 5

class TinyGNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.input_layer = nn.Linear(INPUTS, HIDDEN)
        self.self_layer = nn.Linear(HIDDEN, HIDDEN)
        self.neighbor_layer = nn.Linear(HIDDEN, HIDDEN)
        self.output_layer = nn.Linear(HIDDEN, ACTIONS)

    def encode(self, x):
        return F.relu(self.input_layer(x))

    def forward(self, self_x, neighbors_x):
        h_self = self.encode(self_x)

        if neighbors_x.shape[0] == 0:
            aggregate = torch.zeros_like(h_self)
        else:
            h_neighbors = self.encode(neighbors_x)
            aggregate = h_neighbors.mean(dim=0)

        z = F.relu(
            self.self_layer(h_self)
            + self.neighbor_layer(aggregate)
        )
        return self.output_layer(z)
```

For one training sample: - `self_x` has shape `[6]`. - `neighbors_x` has
shape `[number_of_neighbors, 6]`. - The target is an integer from 0 to
4.

For a batch, write a collate function or padding/mask scheme so variable
neighbor counts are handled correctly. Do not let padded zero rows
accidentally count as real neighbors in the mean.

A simple supervised objective is:

``` python
loss = torch.nn.functional.cross_entropy(
    predicted_scores.unsqueeze(0),
    target_action.reshape(1)
)
```

This illustrates a single sample; a real training loop should batch
examples, call `loss.backward()`, update an optimizer, and validate on
held-out scenarios.

### Label quality and safety

If the teacher chooses an action that is unsafe, the model may learn
that behavior. Apply the same action mask during data generation and
deployment. Also test whether the teacher labels contain a useful
distribution of `WAIT` actions; otherwise the model may learn to move at
every step.

------------------------------------------------------------------------

## 10. Export trained weights to C++

PyTorch's `nn.Linear.weight` shape is `[out_features, in_features]`,
which matches the C++ loops shown above.

Export each layer's weights and biases into C++ initializer arrays. For
example:

``` python
model.eval()

for name, tensor in model.state_dict().items():
    values = tensor.detach().cpu().numpy()
    print(f"// {name}: shape={values.shape}")
    print(values.tolist())
```

Copy the values into the matching arrays in `tiny_gnn.h`, preserving
dimensions and ordering. For a repeatable project, write a small export
script that formats values directly as C++ initializers rather than
manually copying them.

### Essential parity test

Before deployment: 1. Select 20--100 fixed test inputs. 2. Run them
through the PyTorch model. 3. Run the same inputs through C++ inference
on a board. 4. Compare all five output scores. 5. Investigate mismatches
caused by feature normalization, layer ordering, bias handling, or
aggregation.

Do not call it a trained deployed GNN until this parity test passes.

------------------------------------------------------------------------

## 11. Build the neighbor table

Maintain one entry per possible robot ID:

``` cpp
struct NeighborRecord {
  bool valid;
  uint16_t lastSequence;
  uint32_t lastSeenMs;
  int16_t x;
  int16_t y;
  int16_t goalX;
  int16_t goalY;
  uint8_t batteryPercent;
  uint8_t priority;
  uint8_t status;
  uint8_t nextAction;
};
```

When a valid packet arrives: 1. Validate its size and protocol version.
2. Reject self-originated packets. 3. Reject invalid IDs and old
sequence numbers. 4. Copy fields into that robot's entry. 5. Record the
receive time.

In the main loop, expire entries whose age exceeds your tested
threshold. The GNN should only use valid, sufficiently fresh neighbor
records.

**Do not run inference in the ESP-NOW callback.** Callbacks should copy
data and return quickly. Inference and logging belong in the normal
loop.

------------------------------------------------------------------------

## 12. Safety filter and conflict handling

The GNN outputs a preference, not a collision-free multi-agent plan.
Apply a safety layer before executing the chosen action.

``` cpp
int chooseSafeAction(const float scores[5],
                     const bool safe[5]) {
  int best = -1;
  float bestScore = -1.0e30f;

  for (int a = 0; a < 5; ++a) {
    if (safe[a] && scores[a] > bestScore) {
      best = a;
      bestScore = scores[a];
    }
  }

  // Action 4 is WAIT. Ensure WAIT is always safe.
  return (best < 0) ? 4 : best;
}
```

The `safe[]` flags must come from the local grid and coordination
protocol, not from the GNN itself.

For a grid-based simulator, check: - The destination is not a wall or
known blocked cell. - The destination is not occupied. - No two robots
have reserved the same destination at the same time. - Two robots are
not traversing the same edge in opposite directions. - The robot has not
received a higher-priority stop or failure condition.

### Limitation of purely local safety

Two peers may have stale or inconsistent state. A simple local occupancy
check cannot guarantee fleet-wide collision freedom. For a more reliable
demo, use time-indexed reservations with a defined tie-break rule, such
as priority followed by robot ID, and have robots announce intended
moves before execution. If the coordination handshake cannot complete,
wait.

For physical robots, use a conservative stop behavior and validate the
safety system independently of the learned policy.

------------------------------------------------------------------------

## 13. Congestion-aware routing and failures

The GNN should be one component of the system, not the whole path
planner.

### Congestion

A robot can derive a congestion score from: - Recent neighbor
positions. - Repeated waiting near a cell. - A local count of
occupied/busy cells. - Failed attempts to reserve the next cell.

Feed the normalized score into feature 4. Make sure the score definition
in training exactly matches deployment.

### Blocked aisle

The policy cannot infer an unseen blocked aisle if it has no sensor, map
update, or feature describing that blockage. In the simulator,
distribute local blocked-cell updates or add candidate-action
availability features. For the hackathon, the safety layer can reject
moves into known blocked cells while a conventional route planner
supplies a detour.

### Robot failure and task transfer

If a robot's heartbeat times out: 1. Peers mark its record stale/failed
according to a documented timeout policy. 2. Do not assume the failed
robot has physically disappeared; its last occupied cell may still be
blocked. 3. Advertise the unfinished task. 4. Healthy robots compute
bids from estimated travel cost, workload, battery, and task priority.
5. Use a deterministic tie-breaker to choose a winner. 6. Announce the
accepted task and expire losing bids.

This auction is a separate distributed coordination mechanism. Do not
claim that the GNN alone implements task allocation unless
task-allocation outputs are actually part of the trained model.

------------------------------------------------------------------------

## 14. Laptop simulator integration

A good hackathon setup is: - Each ESP8266 decides its own next action. -
Each board sends state/action telemetry to the laptop through USB
serial, or through a deliberately designed telemetry path. - The laptop
updates the 2D display and records metrics. - The laptop may inject a
test event, such as closing a corridor, but should distribute the event
to robots rather than calculate their actions.

The laptop must not act as a hidden central movement controller. If a
scenario coordinator broadcasts map changes, document that role
separately from local movement decisions.

For the first demo, the simulator can run in discrete time: 1. Collect
the current state/action from every robot. 2. Check proposed moves for
conflicts. 3. Commit only safe moves. 4. Send the resulting state back
to the robot controllers. 5. Log task progress and recovery time.

This is a hardware-in-the-loop simulation, not proof of safe physical
robot motion.

------------------------------------------------------------------------

## 15. Test plan and metrics

Run identical scenarios for a conventional baseline and the GNN policy.

### Scenarios

1.  No disruption.
2.  Two robots approach the same narrow corridor.
3.  A corridor becomes blocked.
4.  One robot stops sending packets.
5.  An urgent task arrives.
6.  A robot has low battery.
7.  Packet loss or stale neighbor state is injected.

### Metrics

  -----------------------------------------------------------------------
  Metric                              What it measures
  ----------------------------------- -----------------------------------
  Task completion rate                Fraction of tasks completed

  Makespan                            Time until all assigned tasks
                                      finish

  Total path length                   Routing efficiency

  Collision / conflict count          Safety-layer interventions and
                                      actual collisions

  Deadlock count                      Episodes with no progress beyond a
                                      defined timeout

  Recovery time                       Time from disruption to restored
                                      progress

  Inference latency                   Time for one local forward pass

  Packet delivery rate                Received valid packets divided by
                                      expected packets

  Communication overhead              Messages/bytes sent per robot

  RAM/flash usage                     Embedded resource cost
  -----------------------------------------------------------------------

Distinguish **attempted conflicting moves**, **safety-filter
rejections**, and **actual collisions**. In simulation, report each
separately.

Do not claim that the GNN is superior unless results support it. A good
result may be that the GNN has comparable performance with less
centralized computation, or that the safety layer catches poor learned
actions.

------------------------------------------------------------------------

## 16. Debugging checklist

### No packets arrive

-   Confirm all boards are on the same channel.
-   Verify MAC addresses and peer registration where required.
-   Confirm the sender and receiver use the same packet structure.
-   Check callback signatures against the installed ESP8266 core
    version.
-   Start with one sender and one receiver.

### GNN scores never change

-   The weights may still be zero.
-   Confirm trained weights were exported and compiled.
-   Print input features and a few output scores.
-   Verify normalization and feature ordering.
-   Confirm the neighbor count and aggregation change when peers are
    added/removed.

### Python and C++ outputs differ

-   Check matrix orientation and weight order.
-   Check bias handling.
-   Check activation placement.
-   Check whether the mean includes padding.
-   Use identical float inputs and compare intermediate layer values.

### Robots collide despite the GNN

-   Treat this as a safety/protocol bug, not something to solve by
    retraining alone.
-   Check edge-swap conflicts and simultaneous destination reservations.
-   Make stale data trigger conservative waiting.
-   Verify that all robots agree on the grid and time-step semantics.

### Memory or timing problems

-   Keep arrays fixed-size.
-   Avoid dynamic allocation in the frequent control loop.
-   Avoid long prints in radio callbacks.
-   Measure heap, stack, inference latency, and packet loss on the
    actual board.
-   Consider int8 inference only after the float implementation passes
    parity tests.

------------------------------------------------------------------------

## 17. Suggested 24-hour hackathon schedule

  -----------------------------------------------------------------------
  Time                                Deliverable
  ----------------------------------- -----------------------------------
  Hours 0--2                          Flash boards; verify serial output
                                      and MAC addresses

  Hours 2--5                          ESP-NOW packet send/receive,
                                      sequence numbers, neighbor table

  Hours 5--7                          Fixed-size C++ inference scaffold
                                      compiling on the ESP8266

  Hours 7--11                         Generate training data and train
                                      the tiny model on laptop

  Hours 11--13                        Export weights and pass Python/C++
                                      parity tests

  Hours 13--16                        Integrate action scores and safety
                                      filter

  Hours 16--19                        Add blocked-aisle and robot-failure
                                      scenarios

  Hours 19--21                        Integrate 2D visualization and
                                      logging

  Hours 21--23                        Run baselines, collect metrics, fix
                                      critical bugs

  Hour 23--24                         Rehearse the demo and prepare
                                      results
  -----------------------------------------------------------------------

**Scope rule:** if time is slipping, prioritize reliable ESP-NOW,
inference, and the safety filter. A small working end-to-end demo is
stronger than an ambitious GNN that never runs on the hardware.

------------------------------------------------------------------------

## 18. Demo script for judges

1.  Show three robot nodes exchanging state over ESP-NOW.
2.  Show each board's local action score or selected action over serial.
3.  Start a multi-robot delivery scenario.
4.  Inject a blocked corridor.
5.  Show affected robots changing their decisions while unaffected
    robots continue.
6.  Stop one robot's messages.
7.  Show peers marking its state stale and initiating task reassignment.
8.  Display task completion, recovery time, message delivery, inference
    latency, and safety-filter interventions.
9.  Compare against the same scenario using a conventional baseline.

Be precise about what is demonstrated: learned local action selection,
peer messaging, safety filtering, and task auctions are distinct
components.

------------------------------------------------------------------------

## 19. Final recommended implementation

For the first working version, use:

-   **Hardware:** 2--3 ESP8266 NodeMCU boards.
-   **Communication:** ESP-NOW on a fixed, compatible channel.
-   **Graph:** each robot plus up to four valid neighbors.
-   **Model:** trained 6-input, 8-hidden-unit message-passing model, 5
    action scores.
-   **Training:** offline supervised imitation of a safe teacher policy.
-   **Inference:** fixed-size C++ arrays and float32.
-   **Safety:** independent action mask plus a simple
    reservation/priority protocol.
-   **Fallback:** wait safely and use conventional route planning when
    observations are stale or the proposed move is invalid.
-   **Evaluation:** compare against a conventional A\* + reservation
    baseline.
-   **Visualization:** laptop-side 2D warehouse display, with local
    robot decisions made on the boards.

### Definition of done

The implementation is ready to present when: - At least two boards
exchange and validate packets reliably. - Each board runs the exported
learned model locally. - Python and C++ inference outputs match on test
inputs. - Neighbor aggregation changes when the graph neighborhood
changes. - Unsafe proposed actions are rejected by the safety layer. - A
blocked-aisle or failure scenario completes without a collision in
repeated tests. - Metrics are collected from actual runs rather than
estimated.

That is a feasible embedded-AI demonstration of decentralized warehouse
coordination, with a clear path to expanding from ESP8266 prototypes to
more capable AMR compute platforms.
