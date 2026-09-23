import React from "react";
import { Composition } from "remotion";

import { ReadmeDemo } from "./ReadmeDemo";

export const Root: React.FC = () => (
  <Composition
    id="ReadmeDemo"
    component={ReadmeDemo}
    durationInFrames={280}
    fps={30}
    width={1200}
    height={675}
  />
);
