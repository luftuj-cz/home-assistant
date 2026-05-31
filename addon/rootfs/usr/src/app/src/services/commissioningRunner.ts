import type { Logger } from "pino";
import type { SettingsRepository } from "../features/settings/settings.repository.js";
import type { TimelineScheduler } from "./timelineScheduler.js";

export interface CommissioningStatus {
  running: boolean;
  modeId?: number;
  modeName?: string;
  index?: number;
  total?: number;
  secondsRemaining?: number;
  intervalSeconds?: number;
}

export class CommissioningRunner {
  private timer: NodeJS.Timeout | null = null;
  private modeIds: number[] = [];
  private modeNames: Record<number, string> = {};
  private currentIndex = 0;
  private stepStartedAt = 0;
  private intervalSeconds = 45;
  private running = false;
  private runId = 0;

  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly timelineScheduler: TimelineScheduler,
    private readonly logger: Logger,
  ) {}

  public async start(
    modes: { id: number; name: string }[],
    intervalSeconds: number,
  ): Promise<void> {
    const runId = ++this.runId;

    if (this.running) {
      this.clearTimer();
      this.settingsRepo.setTimelineOverride(null);
    }

    this.modeIds = modes.map((m) => m.id);
    this.modeNames = Object.fromEntries(modes.map((m) => [m.id, m.name]));
    this.intervalSeconds = intervalSeconds;
    this.currentIndex = 0;
    this.running = true;

    this.logger.info(
      { modeCount: modes.length, intervalSeconds },
      "CommissioningRunner: Starting commissioning run",
    );

    try {
      await this.applyCurrentStep(runId, true);
    } catch (err) {
      if (this.runId === runId) {
        this.fail(runId, err);
      }
      throw err;
    }
  }

  public async stop(): Promise<void> {
    if (!this.running) return;

    this.runId++;
    this.clearTimer();
    this.running = false;
    await this.restoreScheduledStateOrThrow();
    this.logger.info("CommissioningRunner: Commissioning run stopped");
  }

  public getStatus(): CommissioningStatus {
    if (!this.running) {
      return { running: false };
    }

    const elapsed = (Date.now() - this.stepStartedAt) / 1000;
    const secondsRemaining = Math.max(0, Math.ceil(this.intervalSeconds - elapsed));
    const modeId = this.modeIds[this.currentIndex];

    return {
      running: true,
      modeId,
      modeName: modeId === undefined ? undefined : this.modeNames[modeId],
      index: this.currentIndex,
      total: this.modeIds.length,
      secondsRemaining,
      intervalSeconds: this.intervalSeconds,
    };
  }

  private async applyCurrentStep(runId: number, scheduleNext = false): Promise<void> {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    if (this.currentIndex >= this.modeIds.length) {
      this.finish(runId);
      return;
    }

    const modeId = this.modeIds[this.currentIndex];
    if (modeId === undefined) {
      this.finish(runId);
      return;
    }

    this.stepStartedAt = Date.now();
    const endTime = new Date(Date.now() + this.intervalSeconds * 1000).toISOString();

    this.settingsRepo.setTimelineOverride({
      modeId,
      endTime,
      durationMinutes: Math.ceil(this.intervalSeconds / 60),
    });

    this.logger.info(
      {
        modeId,
        modeName: this.modeNames[modeId],
        index: this.currentIndex,
        total: this.modeIds.length,
        intervalSeconds: this.intervalSeconds,
      },
      "CommissioningRunner: Applying step",
    );

    await this.timelineScheduler.executeScheduledEventOrThrow();

    if (!scheduleNext || !this.isCurrentRun(runId)) {
      return;
    }

    this.timer = setTimeout(() => {
      if (!this.isCurrentRun(runId)) {
        return;
      }

      this.currentIndex++;
      void this.applyCurrentStep(runId, true).catch((err) => {
        if (this.runId === runId) {
          this.fail(runId, err);
        }
      });
    }, this.intervalSeconds * 1000);
  }

  private finish(runId: number): void {
    if (!this.isCurrentRun(runId)) {
      return;
    }

    this.clearTimer();
    this.running = false;
    void this.restoreScheduledStateOrThrow()
      .then(() => {
        this.logger.info("CommissioningRunner: Commissioning run completed all modes");
      })
      .catch((restoreError) => {
        this.logger.error(
          { restoreError },
          "CommissioningRunner: Failed to restore scheduled state after completion",
        );
      });
  }

  private fail(runId: number, err: unknown): void {
    if (this.runId !== runId) {
      return;
    }

    this.clearTimer();
    this.running = false;
    this.logger.error({ err }, "CommissioningRunner: Commissioning run failed");
    void this.restoreScheduledStateOrThrow().catch((restoreError) => {
      this.logger.error(
        { err, restoreError },
        "CommissioningRunner: Failed to restore scheduled state after run failure",
      );
    });
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private isCurrentRun(runId: number): boolean {
    return this.running && this.runId === runId;
  }

  private async restoreScheduledStateOrThrow(): Promise<void> {
    this.settingsRepo.setTimelineOverride(null);
    await this.timelineScheduler.executeScheduledEventOrThrow();
  }
}
