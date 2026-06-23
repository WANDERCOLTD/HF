import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page Object for the Call Simulation page (/x/sim/[callerId])
 *
 * WhatsApp-style chat UI with streaming AI responses.
 */
export class SimPage extends BasePage {
  readonly path: string;

  // Header
  readonly headerTitle: Locator;

  // Messages area
  readonly messageBubbles: Locator;
  readonly typingIndicator: Locator;

  // Input
  readonly messageInput: Locator;
  readonly sendButton: Locator;

  // End call sheet
  readonly endCallButton: Locator;
  readonly pipelineToggle: Locator;
  readonly confirmEndButton: Locator;
  readonly cancelEndButton: Locator;

  // Toast
  readonly toast: Locator;

  constructor(page: Page, callerId: string) {
    super(page);
    this.path = `/x/sim/${callerId}`;

    // Use .last() — first match is conversation list header ("HF Simulator"), second is the chat pane header (caller name)
    this.headerTitle = page.locator('.wa-header-title').last();
    this.messageBubbles = page.locator('.wa-bubble');
    this.typingIndicator = page.locator('.wa-typing');
    this.messageInput = page.locator('.wa-input-field');
    this.sendButton = page.locator('.wa-send-btn');

    // End call — the button in the header with "End" text
    this.endCallButton = page.locator('.wa-header').getByRole('button', { name: /end/i });

    // End call sheet elements
    this.pipelineToggle = page.locator('.wa-toggle');
    this.confirmEndButton = page.getByRole('button', { name: 'End Call', exact: true });
    this.cancelEndButton = page.getByRole('button', { name: 'Cancel' });

    this.toast = page.locator('.wa-toast');
  }

  /** Wait for the AI greeting message to appear.
   *  Post-redesign the Sim picker no longer auto-greets — the operator
   *  must click "Start chat session" to enter the chat surface, then
   *  the AI emits the greeting bubble. */
  async waitForGreeting(timeout = 30_000): Promise<void> {
    // Click "Start chat session" if the picker is rendered (no-op once
    // the chat surface is mounted).
    const startBtn = this.page.getByRole('button', { name: /Start chat session/i });
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click();
    }
    // Wait for at least one assistant bubble with content
    await this.page.waitForFunction(
      () => {
        const bubbles = document.querySelectorAll('.wa-bubble-in');
        return Array.from(bubbles).some(b => (b.textContent?.trim().length || 0) > 5);
      },
      { timeout }
    );
  }

  /** Send a message and wait for it to appear */
  async sendMessage(text: string): Promise<void> {
    await this.messageInput.fill(text);
    // Force click — floating toasts/badges can intercept pointer events
    await this.sendButton.click({ force: true });
  }

  /** Wait for AI to finish streaming a response */
  async waitForResponse(timeout = 30_000): Promise<void> {
    // Wait for typing indicator to appear then disappear (streaming done)
    try {
      await this.typingIndicator.waitFor({ state: 'visible', timeout: 10_000 });
    } catch {
      // Typing might be so fast we miss it — continue
    }
    // Wait for streaming to end (no typing indicator visible)
    await this.page.waitForFunction(
      () => !document.querySelector('.wa-typing'),
      { timeout }
    );
    // Brief pause for content to settle
    await this.page.waitForTimeout(500);
  }

  /** Get the count of message bubbles */
  async getMessageCount(): Promise<number> {
    return this.messageBubbles.count();
  }

  /** Get the text content of the last message */
  async getLastMessage(): Promise<string> {
    const bubbles = this.messageBubbles;
    const count = await bubbles.count();
    if (count === 0) return '';
    return (await bubbles.nth(count - 1).textContent()) || '';
  }

  /** End the call via the end call sheet */
  async endCall(runPipeline = false): Promise<void> {
    await this.endCallButton.click();

    // Wait for end call sheet
    await this.page.getByText('End this call?').waitFor({ state: 'visible' });

    // Toggle pipeline if needed (default is on, so click to turn off if !runPipeline)
    const isActive = await this.pipelineToggle.evaluate(
      el => el.classList.contains('active')
    );
    if (runPipeline !== isActive) {
      await this.pipelineToggle.click();
    }

    await this.confirmEndButton.click();
  }

  /** Wait for the toast notification */
  async waitForToast(timeout = 10_000): Promise<string> {
    await this.toast.waitFor({ state: 'visible', timeout });
    return (await this.toast.textContent()) || '';
  }
}
