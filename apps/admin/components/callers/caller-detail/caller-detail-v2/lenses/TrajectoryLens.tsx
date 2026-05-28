"use client";

import React from "react";
import { LearningTrajectoryCard } from "../../cards/LearningTrajectoryCard";

type Props = {
  callerId: string;
};

/**
 * Trajectory lens — Progress v2 single canonical home for the existing
 * v1 `LearningTrajectoryCard`. Post-cutover this lens is the only place
 * the card renders.
 */
export function TrajectoryLens({ callerId }: Props): React.ReactElement {
  return (
    <div className="hf-progress-v2-lens">
      <LearningTrajectoryCard callerId={callerId} />
    </div>
  );
}
