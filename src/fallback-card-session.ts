import type { LarkCli } from "./lark-cli.js";
import { renderResponseCard } from "./response-card.js";

export class FallbackCardSession {
  private sequence: number;

  private constructor(
    private readonly lark: LarkCli,
    readonly cardId: string,
    readonly messageId: string,
    sequence = 0,
  ) {
    this.sequence = sequence;
  }

  static async create(
    lark: LarkCli,
    replyToMessageId: string,
    text: string,
    phase: string,
    idempotencyKey: string,
  ): Promise<FallbackCardSession> {
    const cardId = await lark.createCard(renderResponseCard(text, phase));
    const messageId = await lark.replyCard(replyToMessageId, cardId, idempotencyKey);
    if (!messageId) throw new Error("飞书没有返回产品回复卡消息 ID");
    return new FallbackCardSession(lark, cardId, messageId);
  }

  static restore(
    lark: LarkCli,
    cardId: string,
    messageId: string,
    sequence = 0,
  ): FallbackCardSession {
    return new FallbackCardSession(lark, cardId, messageId, sequence);
  }

  get sequenceNumber(): number {
    return this.sequence;
  }

  async update(text: string, phase: string): Promise<boolean> {
    try {
      this.sequence += 1;
      await this.lark.updateCard(
        this.cardId,
        renderResponseCard(text, phase),
        this.sequence,
      );
      return true;
    } catch (error) {
      console.error(`[card] fallback update failed card=${this.cardId}`, error);
      return false;
    }
  }
}
