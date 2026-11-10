import { useCallback, useEffect, useRef, useState } from "react";
import { researchStageLines, type ResearchStage, type ResearchStatus } from "@/lib/report";

/**
 * Simulerad statusrapportering för demo.
 *
 * Den driver exakt samma statusform som en backend ska skicka in, går aldrig i
 * mål av sig själv (sista steget ligger kvar) och kan stoppas. Den riktiga
 * rapportkällan rapporterar i stället sina steg via `requestReport(..., { onStage })`.
 */
export function useSimulatedResearch(stageIntervalMs = 1400) {
  const [status, setStatus] = useState<ResearchStatus>({ stages: [], elapsedSeconds: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    setIsRunning(false);
  }, []);

  const start = useCallback(() => {
    window.clearInterval(timerRef.current);
    const total = researchStageLines.length;
    const startedAt = Date.now();
    setStatus({ stages: [{ index: 0, total, label: researchStageLines[0] }], elapsedSeconds: 0 });
    setIsRunning(true);

    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const reached = Math.min(Math.floor((Date.now() - startedAt) / stageIntervalMs), total - 1);
      setStatus((previous) => {
        const stages: ResearchStage[] = previous.stages.filter((stage) => stage.index <= reached);
        if (!stages.some((stage) => stage.index === reached)) {
          stages.push({ index: reached, total, label: researchStageLines[reached] });
        }
        return { stages, elapsedSeconds: elapsed };
      });
    }, 250);
  }, [stageIntervalMs]);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  return { status, isRunning, start, stop };
}
