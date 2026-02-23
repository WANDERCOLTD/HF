import { Page, Locator } from '@playwright/test';
import { BasePage } from './base.page';

/**
 * Page Object for the Teach page (/x/teach)
 *
 * Step-based flow: Institution → Goal → Content → Plan Sessions → Launch
 */
export class TeachPage extends BasePage {
  readonly path = '/x/teach';

  readonly heading: Locator;
  readonly institutionSelector: Locator;
  /** @deprecated Readiness is now shown on the Launch step, not a separate section */
  readonly readinessSection: Locator;
  readonly startSessionButton: Locator;
  readonly viewInstitutionButton: Locator;
  readonly quickLaunchButton: Locator;

  // Step flow
  readonly goalInput: Locator;
  readonly nextButton: Locator;
  readonly backButton: Locator;

  constructor(page: Page) {
    super(page);

    this.heading = page.getByRole('heading', { name: 'Teach' });
    this.institutionSelector = page.getByText('Institution').locator('..');
    this.readinessSection = page.getByText('Course Readiness').locator('..');
    this.startSessionButton = page.getByRole('button', { name: /start (lesson|training session|coaching session|patient session)/i });
    this.viewInstitutionButton = page.getByRole('button', { name: /view institution/i });
    this.quickLaunchButton = page.getByRole('button', { name: 'Quick Launch' });

    // Step flow elements
    this.goalInput = page.getByPlaceholder(/what do you want to teach/i);
    this.nextButton = page.getByRole('button', { name: /next/i });
    this.backButton = page.getByRole('button', { name: /back/i });
  }
}
