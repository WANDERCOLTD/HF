import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page Object for the Demonstrate page (/x/demonstrate)
 *
 * Step-based flow: Domain & Caller → Goal → Content → Launch
 */
export class DemonstratePage extends BasePage {
  readonly path = '/x/demonstrate';

  readonly heading: Locator;
  readonly domainSelector: Locator;
  /** @deprecated Readiness is now shown on the Launch step, not a separate section */
  readonly readinessSection: Locator;
  readonly startLessonButton: Locator;
  readonly viewDomainButton: Locator;
  readonly quickLaunchButton: Locator;

  // Step flow
  readonly goalInput: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);

    this.heading = page.getByRole('heading', { name: 'Demonstrate' });
    this.domainSelector = page.getByText('Domain').locator('..');
    this.readinessSection = page.getByText('Course Readiness').locator('..');
    this.startLessonButton = page.getByRole('button', { name: 'Start Lesson' });
    this.viewDomainButton = page.getByRole('button', { name: 'View Domain' });
    this.quickLaunchButton = page.getByRole('button', { name: 'Quick Launch' });

    // Step flow elements
    this.goalInput = page.getByPlaceholder(/what do you want to demonstrate/i);
    this.nextButton = page.getByRole('button', { name: /next/i });
    this.backButton = page.getByRole('button', { name: /back/i });
  }
}
