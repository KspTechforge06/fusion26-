/*
 * FUSION26 - embedded weights for the tiny message-passing GNN.
 *
 * ------------------------------------------------------------------
 * These are BOOTSTRAP / HEURISTIC weights written by hand so the
 * firmware runs a non-degenerate policy out of the box. They are NOT
 * the output of a training run. Per the implementation guide, describe
 * a hand-built policy as "GNN-inspired", not as a trained GNN.
 *
 * To use a real trained model:
 *     cd tools
 *     python3 train_gnn.py            # trains and overwrites this file
 *   or
 *     python3 export_weights.py tiny_gnn.pt
 *
 * Shapes (must match tiny_gnn.h):
 *     W_IN[HIDDEN][INPUTS]      = [8][6]
 *     B_IN[HIDDEN]              = [8]
 *     W_SELF[HIDDEN][HIDDEN]    = [8][8]
 *     W_NEIGHBOR[HIDDEN][HIDDEN]= [8][8]
 *     B_HIDDEN[HIDDEN]          = [8]
 *     W_OUT[ACTIONS][HIDDEN]    = [5][8]
 *     B_OUT[ACTIONS]            = [5]
 *
 * Feature order: [relGoalX, relGoalY, battery, priority, congestion,
 *                 status]
 * Action order : [up, down, left, right, wait]
 *
 * How these bootstrap weights behave:
 *   - hidden 0..3 detect movement-toward-goal (right/left/down/up)
 *   - hidden 4 detects self congestion
 *   - hidden 5 detects blocked/failed status
 *   - hidden 6 detects low battery
 *   - hidden 7 detects high priority
 *   - W_SELF is the identity, W_NEIGHBOR feeds neighbours' congestion
 *     and status into the same units (permutation-invariant mean), so
 *     the WAIT score rises when nearby peers are blocked.
 * ------------------------------------------------------------------
 */
#pragma once

/* W_IN[8][6]: [relGoalX, relGoalY, battery, priority, congestion, status] */
static const float W_IN[8][6] = {
    { 1, 0, 0, 0, 0, 0},  /* h0 = relu(+relGoalX)   -> want RIGHT */
    {-1, 0, 0, 0, 0, 0},  /* h1 = relu(-relGoalX)   -> want LEFT  */
    { 0, 1, 0, 0, 0, 0},  /* h2 = relu(+relGoalY)   -> want DOWN  */
    { 0,-1, 0, 0, 0, 0},  /* h3 = relu(-relGoalY)   -> want UP    */
    { 0, 0, 0, 0, 1, 0},  /* h4 = relu(congestion)                */
    { 0, 0, 0, 0, 0, 1},  /* h5 = relu(status)      -> blocked    */
    { 0, 0,-1, 0, 0, 0},  /* h6 = relu(0.3 - battery) low battery */
    { 0, 0, 0, 1, 0, 0},  /* h7 = relu(priority-0.5)              */
};

static const float B_IN[8] = {0, 0, 0, 0, 0, 0, 0.3f, -0.5f};

/* W_SELF = identity: z = relu(W_SELF*h_self + W_NEIGHBOR*m + b) */
static const float W_SELF[8][8] = {
    {1,0,0,0,0,0,0,0},
    {0,1,0,0,0,0,0,0},
    {0,0,1,0,0,0,0,0},
    {0,0,0,1,0,0,0,0},
    {0,0,0,0,1,0,0,0},
    {0,0,0,0,0,1,0,0},
    {0,0,0,0,0,0,1,0},
    {0,0,0,0,0,0,0,1},
};

/* Feed neighbour congestion/status/low-battery into the same units.   */
static const float W_NEIGHBOR[8][8] = {
    {0,0,0,0,0,0,0,0},
    {0,0,0,0,0,0,0,0},
    {0,0,0,0,0,0,0,0},
    {0,0,0,0,0,0,0,0},
    {0,0,0,0,1,0,0,0},
    {0,0,0,0,0,1,0,0},
    {0,0,0,0,0,0,1,0},
    {0,0,0,0,0,0,0,0},
};

static const float B_HIDDEN[8] = {0, 0, 0, 0, 0, 0, 0, 0};

/* W_OUT[5][8]: actions up, down, left, right, wait */
static const float W_OUT[5][8] = {
    {0,0,0,3.0f,0,0,0,0},          /* UP    <- h3 */
    {0,0,3.0f,0,0,0,0,0},          /* DOWN  <- h2 */
    {0,3.0f,0,0,0,0,0,0},          /* LEFT  <- h1 */
    {3.0f,0,0,0,0,0,0,0},          /* RIGHT <- h0 */
    {0,0,0,0,0.5f,3.0f,0.5f,0},    /* WAIT  <- congestion/status/battery */
};

static const float B_OUT[5] = {0, 0, 0, 0, 0.05f};
