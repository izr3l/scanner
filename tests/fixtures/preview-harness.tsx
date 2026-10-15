import { StrictMode, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { PreviewImage } from "../../components/editor/preview-image";

type Name = "a" | "b" | "c";
type State = { name: Name; instant: boolean; label: string };

declare global {
  interface Window {
    previewHarness: {
      choose(name: Name, instant?: boolean): void;
      relabel(label: string): void;
      unmount(): void;
      setups: number;
      cleanups: number;
      loads: { name: Name; src: string }[];
    };
  }
}

const blobs = Object.fromEntries((["a", "b", "c"] as Name[]).map((name, index) => [name, new Blob([
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="220"><rect width="160" height="220" fill="${["#08b46a", "#365cd7", "#d54882"][index]}"/><circle cx="80" cy="110" r="40" fill="white"/></svg>`,
], { type: "image/svg+xml" })])) as Record<Name, Blob>;
const root = createRoot(document.getElementById("root")!);
const harness: Window["previewHarness"] = window.previewHarness = {
  choose: () => { throw new Error("Harness has not mounted."); },
  relabel: () => { throw new Error("Harness has not mounted."); },
  unmount: () => root.unmount(),
  setups: 0, cleanups: 0, loads: [],
};

function Harness() {
  const [state, setState] = useState<State>({ name: "a", instant: false, label: "Synthetic preview a" });
  useLayoutEffect(() => {
    harness.setups += 1;
    harness.choose = (name, instant = false) => flushSync(() => setState({ name, instant, label: `Synthetic preview ${name}` }));
    harness.relabel = (label) => flushSync(() => setState((state) => ({ ...state, label })));
    return () => { harness.cleanups += 1; };
  }, []);
  return <PreviewImage blob={blobs[state.name]} alt={state.label} transitionKey={state.name} instant={state.instant}
    onLoad={(event) => harness.loads.push({ name: state.name, src: event.currentTarget.src })} />;
}

root.render(<StrictMode><Harness /></StrictMode>);
