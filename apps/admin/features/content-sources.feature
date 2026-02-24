Feature: Materials
  As an educator or admin
  I want to upload course materials and extract teaching content
  So that the AI tutor has accurate, trusted curriculum to teach from

  Background:
    Given I am authenticated as an ADMIN or EDUCATOR user
    And a domain exists with a published playbook

  # =============================================================================
  # MATERIAL WIZARD (Multi-Step)
  # =============================================================================

  @wizard @critical
  Scenario: Material wizard follows step sequence
    When I navigate to /x/content-sources and start the wizard
    Then the wizard should present steps in order:
      | step    | name      | description                              |
      | 1       | Source    | Upload files or enter text                |
      | 2       | Extract   | AI extracts teaching points               |
      | 3       | Plan      | Review and edit extraction plan            |
      | 4       | Preview   | Preview extracted content                  |
      | 5       | Review    | Review questions, vocabulary, assertions   |
      | 6       | Done      | Summary and next steps                    |

  # =============================================================================
  # STEP 1: SOURCE (Upload)
  # =============================================================================

  @wizard @source
  Scenario: Upload a document as material
    Given I am on the Source step
    When I upload a PDF file "chapter-1.pdf"
    Then the file should be stored as a ContentSource record
    And the DocumentType should be classified (TEXTBOOK, CURRICULUM, etc.)

  @wizard @source
  Scenario: Multiple files can be uploaded
    Given I am on the Source step
    When I upload 3 files
    Then 3 ContentSource records should be created
    And I should see all 3 in the source list

  # =============================================================================
  # STEP 2: EXTRACT (AI Processing)
  # =============================================================================

  @wizard @extract
  Scenario: AI extracts teaching content from uploaded document
    Given a ContentSource exists with uploaded file
    When the Extract step processes the document
    Then the AI should extract:
      | content type       |
      | ContentAssertion   |
      | ContentQuestion    |
      | ContentVocabulary  |
    And each extraction should have a ContentTrustLevel

  @wizard @extract
  Scenario: Content trust levels are assigned
    Given content is extracted from a regulatory document
    Then assertions should have trustLevel based on DocumentType:
      | DocumentType          | Default TrustLevel    |
      | CURRICULUM            | REGULATORY_STANDARD   |
      | TEXTBOOK              | ACCREDITED_MATERIAL   |
      | WORKSHEET             | EXPERT_CURATED        |
      | EXAMPLE               | AI_ASSISTED           |
      | ASSESSMENT            | EXPERT_CURATED        |

  # =============================================================================
  # STEP 3: PLAN (Review Extraction Plan)
  # =============================================================================

  @wizard @plan
  Scenario: Review extraction plan before processing
    Given extraction has completed
    When I view the Plan step
    Then I should see a summary of extracted content:
      | metric      | description                    |
      | Assertions  | Number of teaching assertions  |
      | Questions   | Number of extracted questions   |
      | Vocabulary  | Number of vocabulary terms      |
    And I should be able to edit the plan

  # =============================================================================
  # STEP 5: REVIEW (Questions & Vocabulary)
  # =============================================================================

  @wizard @review
  Scenario: Review extracted questions
    Given 10 ContentQuestion records were extracted
    When I view the Review step's Questions panel
    Then I should see all 10 questions
    And each question should show:
      | field        | description                |
      | type         | MCQ, TRUE_FALSE, etc.      |
      | text         | The question text          |
      | trustLevel   | Content trust level        |
    And I should be able to approve, edit, or reject each question

  @wizard @review
  Scenario: Review extracted vocabulary
    Given 5 ContentVocabulary records were extracted
    When I view the Review step's Vocabulary panel
    Then I should see all 5 terms with definitions
    And I should be able to approve or reject each term

  @wizard @review
  Scenario: Review tab shows badge counts
    When I view the Review step
    Then the Questions tab should show a count badge
    And the Vocabulary tab should show a count badge

  # =============================================================================
  # MATERIALS LIBRARY
  # =============================================================================

  @library
  Scenario: View materials library
    When I navigate to /x/content-sources
    Then I should see a list of all ContentSource records
    And each source should show:
      | field         | description                |
      | name          | Source name                |
      | documentType  | Document classification    |
      | trustLevel    | Content trust level        |
      | status        | Processing status          |
      | assertionCount| Number of assertions       |

  @library
  Scenario: Active jobs banner shows processing status
    Given 2 materials are currently being processed
    When I view /x/content-sources
    Then the ActiveJobsBanner should show 2 active jobs
    And each job should show progress

  # =============================================================================
  # CONTENT IMPORT
  # =============================================================================

  @import
  Scenario: Import material into domain
    Given a reviewed ContentSource exists
    When I POST /api/content-sources/{sourceId}/import
    Then the content should be linked to the domain's CONTENT spec
    And ContentAssertions should be imported
    And the import should classify content by DocumentType

  # =============================================================================
  # AUTHORIZATION
  # =============================================================================

  @auth
  Scenario: Material routes require authentication
    Given the following material routes exist:
      | route                                     | method |
      | /api/content-sources                      | GET    |
      | /api/content-sources                      | POST   |
      | /api/content-sources/{sourceId}           | GET    |
      | /api/content-sources/{sourceId}/import    | POST   |
    Then all require authentication via requireAuth()
