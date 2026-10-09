#!/usr/bin/env python3
"""
FUSION26 - train the tiny message-passing GNN (offline, on the laptop)
and export the weights to ../tiny_gnn_weights.h.

The model is DISTILLED from a conventional teacher policy (see the
implementation guide, section 9): imitation learning, not RL.

Architecture is kept byte-for-byte compatible with ../tiny_gnn.h:
    h = relu(W_in x + b_in)
    m = mean(h of neighbours)                 (0 if none)
    z = relu(W_self h + W_neighbor m + b_hidden)
    q = W_out z + b_out

Run:
    python3 train_gnn.py --samples 40000 --epochs 40
"""
import argparse
import random

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from export_weights import export_header

INPUTS = 6
HIDDEN = 8
ACTIONS = 5
MAX_NEIGHBORS = 4
MAX_DIST = 20.0
PRIORITY_MAX = 10
GRID = 24

DX = [0, 0, -1, 1, 0]   # up, down, left, right, wait
DY = [-1, 1, 0, 0, 0]


class TinyGNN(nn.Module):
    """Must mirror ../tiny_gnn.h exactly."""

    def __init__(self):
        super().__init__()
        self.input_layer = nn.Linear(INPUTS, HIDDEN)                 # W_IN, B_IN
        self.self_layer = nn.Linear(HIDDEN, HIDDEN, bias=False)      # W_SELF
        self.neighbor_layer = nn.Linear(HIDDEN, HIDDEN, bias=False)  # W_NEIGHBOR
        self.hidden_bias = nn.Parameter(torch.zeros(HIDDEN))         # B_HIDDEN
        self.output_layer = nn.Linear(HIDDEN, ACTIONS)               # W_OUT, B_OUT

    def encode(self, x):
        return F.relu(self.input_layer(x))

    def forward(self, self_x, neighbors_x, mask=None):
        h_self = self.encode(self_x)
        if neighbors_x.shape[0] == 0:
            aggregate = torch.zeros_like(h_self)
        else:
            h_neighbors = self.encode(neighbors_x)
            if mask is not None:
                m = mask.unsqueeze(-1)
                h_neighbors = h_neighbors * m
                aggregate = h_neighbors.sum(dim=0) / m.sum().clamp(min=1.0)
            else:
                aggregate = h_neighbors.mean(dim=0)
        z = F.relu(self.self_layer(h_self)
                   + self.neighbor_layer(aggregate)
                   + self.hidden_bias)
        return self.output_layer(z)


def clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def features(dx, dy, bat, pri, cong, status):
    return [
        clamp(dx / MAX_DIST, -1.0, 1.0),
        clamp(dy / MAX_DIST, -1.0, 1.0),
        bat / 100.0,
        pri / PRIORITY_MAX,
        clamp(cong, 0.0, 1.0),
        1.0 if status in (2, 3) else 0.0,
    ]


def teacher(sx, sy, gx, gy, neighbors, blocked):
    """Conventional safe teacher -> action label 0..4.

    neighbors: list of (x, y, priority, next_action)
    blocked:   set of static obstacle cells
    """
    if (sx, sy) == (gx, gy):
        return 4
    dx, dy = gx - sx, gy - sy
    cands = []
    if dx > 0:
        cands.append(3)
    if dx < 0:
        cands.append(2)
    if dy > 0:
        cands.append(1)
    if dy < 0:
        cands.append(0)
    # longer axis first for a straighter line
    cands.sort(key=lambda a: abs(dx) if a in (2, 3) else abs(dy), reverse=True)

    for a in cands:
        tx, ty = sx + DX[a], sy + DY[a]
        if (tx, ty) in blocked:
            continue
        if any(nx == tx and ny == ty for nx, ny, _, _ in neighbors):
            continue
        # simultaneous destination claim vs higher-priority peer
        lose = False
        for nx, ny, npri, nact in neighbors:
            if (nx + DX[nact], ny + DY[nact]) == (tx, ty) and npri > 5:
                lose = True
        if lose:
            continue
        return a
    return 4


def make_sample(rng):
    sx, sy = rng.randrange(GRID), rng.randrange(GRID)
    gx, gy = rng.randrange(GRID), rng.randrange(GRID)
    n = rng.randrange(0, MAX_NEIGHBORS + 1)
    neighbors = []
    for _ in range(n):
        nx = clamp(sx + rng.randrange(-5, 6), 0, GRID - 1)
        ny = clamp(sy + rng.randrange(-5, 6), 0, GRID - 1)
        if (nx, ny) == (sx, sy):
            continue
        npri = rng.randrange(0, PRIORITY_MAX + 1)
        nact = rng.randrange(0, 5)
        neighbors.append((nx, ny, npri, nact))

    label = teacher(sx, sy, gx, gy, neighbors, blocked=set())

    cong = sum(1 for nx, ny, _, _ in neighbors
               if abs(nx - sx) + abs(ny - sy) <= 4) / 5.0
    self_f = features(gx - sx, gy - sy, rng.randrange(20, 101),
                      rng.randrange(0, PRIORITY_MAX + 1), cong, 0)
    neigh_f = []
    for nx, ny, npri, _ in neighbors:
        # neighbours do not broadcast congestion; use 0 (matches firmware)
        st = 2 if rng.random() < 0.15 else 0
        neigh_f.append(features(gx - nx, gy - ny,
                                rng.randrange(20, 101), npri, 0.0, st))
    return self_f, neigh_f, label


def build_dataset(count, seed=0):
    rng = random.Random(seed)
    selfs, neighs, labels = [], [], []
    for _ in range(count):
        s, n, y = make_sample(rng)
        selfs.append(s)
        neighs.append(n)
        labels.append(y)
    return selfs, neighs, labels


def collate(selfs, neighs, idx):
    batch_self = torch.tensor([selfs[i] for i in idx], dtype=torch.float32)
    batch_y = torch.tensor([labels_global[i] for i in idx], dtype=torch.long)
    max_n = MAX_NEIGHBORS
    nb = torch.zeros((len(idx), max_n, INPUTS), dtype=torch.float32)
    mask = torch.zeros((len(idx), max_n), dtype=torch.float32)
    for row, i in enumerate(idx):
        for j, fvec in enumerate(neighs[i][:max_n]):
            nb[row, j] = torch.tensor(fvec, dtype=torch.float32)
            mask[row, j] = 1.0
    return batch_self, nb, mask, batch_y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=40000)
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-2)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", type=str, default="tiny_gnn.pt")
    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    global labels_global
    print("Generating data ...")
    selfs, neighs, labels = build_dataset(args.samples, args.seed)
    labels_global = labels

    split = int(0.9 * len(selfs))
    train_idx = list(range(split))
    val_idx = list(range(split, len(selfs)))

    model = TinyGNN()
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)

    for epoch in range(1, args.epochs + 1):
        random.shuffle(train_idx)
        model.train()
        total = 0.0
        for b in range(0, len(train_idx), args.batch):
            idx = train_idx[b:b + args.batch]
            bs, nb, mask, by = collate(selfs, neighs, idx)
            opt.zero_grad()
            # forward each sample's variable neighbour set via a loop for
            # clarity; small model, small batch -> fine on a laptop.
            losses = []
            for k in range(len(idx)):
                q = model(bs[k], nb[k][mask[k] > 0])
                losses.append(F.cross_entropy(q.unsqueeze(0), by[k].reshape(1)))
            loss = torch.stack(losses).mean()
            loss.backward()
            opt.step()
            total += float(loss) * len(idx)

        model.eval()
        correct = 0
        with torch.no_grad():
            for k in val_idx:
                svec = torch.tensor(selfs[k], dtype=torch.float32)
                nvec = torch.tensor(neighs[k], dtype=torch.float32)
                q = model(svec, nvec)
                correct += int(q.argmax().item() == labels[k])
        acc = correct / max(1, len(val_idx))
        print(f"epoch {epoch:3d}  loss={total/len(train_idx):.4f}  val_acc={acc:.3f}")

    torch.save(model.state_dict(), args.out)
    print(f"saved {args.out}")
    export_header(model.state_dict(), "../tiny_gnn_weights.h")
    print("wrote ../tiny_gnn_weights.h")


labels_global = []

if __name__ == "__main__":
    main()
