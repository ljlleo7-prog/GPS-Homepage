# Product Requirements Document: Phase 1 Community Participation Upgrade

**Version**: 1.0
**Date**: 2026-03-20
**Author**: Sarah (Product Owner)
**Scope**: Existing GPS website, conservative Phase 1 only

---

## Executive Summary

This Phase 1 PRD defines a conservative upgrade path for improving community participation on the existing GPS website without destabilizing the current economy or upsetting active users.

The website already has a live user base that cares about the current system, especially minigames, driver betting, and wallet consistency. Because of that, Phase 1 does **not** attempt to redesign the economy, rebalance rewards, or reinterpret existing user value. Instead, it improves participation by restructuring forum use, strengthening mission-based contribution pathways, improving project-to-community linking, and adding non-economic recognition.

The success condition for Phase 1 is simple: users should have better ways to participate, contribute, and belong, while continuing to trust the existing wallet, minigame, and driver betting systems.

---

## Problem Statement

**Current Situation**: The platform already supports a working economy, discussion, missions, minigames, and driver betting. However, participation quality is still limited. Users can comment, react, and engage with systems, but the platform does not yet consistently guide them toward deeper contribution, structured collaboration, or project-centered community involvement.

At the same time, the current economy is socially sensitive. Existing users may react negatively to abrupt redesigns that affect balances, reward logic, or the perceived fairness of minigames, driver betting, and wallet progression.

**Proposed Solution**: Phase 1 should improve the structure of participation without redesigning the protected economy layer. The platform should add clearer contribution pathways, better discussion structure, project-linked participation routes, and non-economic recognition systems.

**Business / Community Impact**: This should increase meaningful participation, reduce shallow one-line engagement, and build stronger contributor pathways while preserving trust with existing users.

---

## Success Metrics

**Primary KPIs:**
- **Structured participation rate**: Increase the share of forum and mission activity that uses structured, contribution-oriented formats rather than casual one-line interaction.
- **Mission contribution depth**: Increase submissions to missions that include useful evidence, detail, or project-relevant value.
- **Repeat participation**: Increase the number of users who return to participate in discussion, missions, or project-linked community activity over time.
- **Economy trust stability**: Maintain user trust by avoiding backlash tied to wallet inconsistency, inflation concerns, minigame devaluation, or driver betting disruption.

**Validation**:
- Track mission submission quality and completion patterns
- Track forum thread type usage and discussion depth
- Track repeat participation by active members
- Monitor user sentiment around fairness, stability, and trust

---

## User Personas

### Primary: Existing Active Community User
- **Role**: Current site user who already cares about minigames, driver betting, and wallet continuity
- **Goals**: Keep favorite systems stable, participate without losing prior progress, remain part of the community
- **Pain Points**: Fear of inconsistency, inflation, or redesign that invalidates past effort
- **Technical Level**: Mixed

### Secondary: Engaged Follower / Fan
- **Role**: Supportive user interested in the creator’s projects and the surrounding community
- **Goals**: Participate more meaningfully than simple commenting, stay connected to what is active
- **Pain Points**: Not enough clear ways to help or join deeper community activity
- **Technical Level**: Novice to Intermediate

### Secondary: Emerging Contributor
- **Role**: User willing to test, document, translate, research, or help projects grow
- **Goals**: Find structured ways to contribute, build reputation, and become more involved
- **Pain Points**: Contribution pathways are not yet clear or consistently structured
- **Technical Level**: Intermediate to Advanced

---

## User Stories & Acceptance Criteria

### Story 1: Participate without fear of economic disruption

**As an** existing active user
**I want to** keep using the site without worrying that my balances or familiar systems will suddenly lose meaning
**So that** I continue to trust the platform

**Acceptance Criteria:**
- [ ] Phase 1 introduces no abrupt wallet reset, rebalance, or semantic redesign.
- [ ] Minigame reward trust is preserved.
- [ ] Driver betting remains visible and supported.
- [ ] New participation systems are additive rather than destructive.

### Story 2: Contribute in more meaningful ways than one-line comments

**As a** community member
**I want to** have structured ways to provide useful input or help
**So that** my participation can matter more

**Acceptance Criteria:**
- [ ] Forum participation includes clearer formats such as test reports, build logs, proposals, or help-needed threads.
- [ ] Users can see examples of more meaningful contribution types.
- [ ] Project-relevant participation is easier to identify than generic chatter.

### Story 3: Follow a clearer path from fan to contributor

**As an** engaged follower
**I want to** understand how to deepen my involvement
**So that** I can move from casual presence into useful participation

**Acceptance Criteria:**
- [ ] Missions are organized in clearer contribution-oriented categories.
- [ ] Projects and community spaces point users toward actionable next steps.
- [ ] Users can distinguish lightweight participation from deeper contribution.

### Story 4: Receive recognition without destabilizing the economy

**As a** participant
**I want to** feel that my efforts are seen and valued
**So that** I stay motivated to help

**Acceptance Criteria:**
- [ ] Phase 1 introduces non-economic recognition such as badges, roles, or visible contribution records.
- [ ] Useful participation can be recognized without broad new TKN emissions.
- [ ] REP and TKN remain governed conservatively.

---

## Functional Requirements

### Core Features

**Feature 1: Homepage Participation Reframing**
- Description: Improve the homepage so it highlights activity, contribution opportunities, and community entry points rather than functioning primarily as a passive landing page.
- User flow: User lands on homepage → sees what is active now → sees ways to join or help → enters discussion or mission flow.
- Edge cases: Some periods may have lower current activity.
- Error handling: If active content is limited, the page should still show stable participation entry points.

**Feature 2: Structured Forum Participation**
- Description: Expand the forum from generic posting into more structured participation spaces with clearer thread purposes and higher-value contribution formats.
- User flow: User enters forum → selects room → posts via clearer participation type or responds to structured prompts.
- Edge cases: Users who prefer normal posting should still be able to participate.
- Error handling: Existing posting behavior should continue to function even if new structures are gradually introduced.

**Feature 3: Mission-Based Contribution Ladder**
- Description: Missions should become the primary structured path for deeper participation, including testing, documentation, translation, research, stewardship, and build-related contributions.
- User flow: User discovers a mission → understands expected contribution type → submits structured work → receives review and recognition.
- Edge cases: Some users may only be ready for beginner-level tasks.
- Error handling: Submission formats should support both lightweight and deeper contribution tiers without overwhelming new users.

**Feature 4: Non-Economic Recognition Layer**
- Description: Introduce visible recognition systems such as badges, roles, contribution labels, or project supporter markers.
- User flow: User participates meaningfully → receives visible recognition → sees that contribution history matters.
- Edge cases: Recognition should not feel arbitrary or spammy.
- Error handling: Recognition criteria should be controlled enough to avoid dilution.

**Feature 5: Project-Linked Participation Paths**
- Description: Projects/products should connect to relevant rooms, missions, updates, and contribution entry points.
- User flow: User views a project or project context → sees where discussion is happening and what needs help → joins the relevant community action.
- Edge cases: Some projects may be early or inactive.
- Error handling: Low-activity projects should still provide at least one clear participation route.

**Feature 6: Social Framing for Protected Activity Loops**
- Description: Minigames and driver betting should be framed as valued community activities, rituals, or event hooks without changing the protected mechanics behind them.
- User flow: User continues current activity → sees stronger social/community framing around that activity.
- Edge cases: Not every user will care about these systems equally.
- Error handling: Existing activity flows must remain stable even if new framing is added.

### Out of Scope
- Wallet redesign
- TKN / REP renaming or rebalance
- Major minigame payout changes
- Major driver betting mechanic changes
- Immediate conversion of markets/bonds into donation systems
- Inflationary new token reward systems
- Broad removal of legacy features

---

## Technical Constraints

### Stability
- Phase 1 must avoid destabilizing existing economy logic.
- Existing wallet balances and trusted loops must remain intact.

### Economy Safety
- New participation features should not depend on broad new TKN emissions.
- REP expansion, if any, should remain conservative and tied to useful contribution.

### Compatibility
- Changes should build on the current React + Supabase application rather than require a full platform rewrite.
- Existing minigame, driver betting, mission, forum, and wallet systems must remain compatible.

### UX Constraints
- New contribution pathways must be clearer without overwhelming current users.
- Existing familiar actions should remain usable during transition.

---

## Phase 1 Scope & Priorities

### Phase 1 Must-Haves
- Homepage/community participation reframing
- Structured forum participation improvements
- Mission categorization for contribution pathways
- Non-economic recognition layer
- Project-linked participation entry points
- Protected treatment of minigames and driver betting

### Phase 1 Nice-to-Haves
- Better surfaced weekly/community activity blocks
- Featured contributor / featured builder modules
- Project-specific prompts or participation calls

### Explicit Deferrals
- Deep economy redesign
- Support-market / bond reinterpretation
- New broad token utility systems
- Major permission threshold redesign

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| Existing users fear economy disruption even when no major changes are intended | High | High | Communicate clearly that balances and protected loops remain stable |
| New contribution features create confusion if layered on top of old flows too abruptly | Medium | Medium | Introduce structure gradually and keep legacy participation paths functional |
| New recognition systems feel arbitrary or diluted | Medium | Medium | Define clear criteria and start conservatively |
| Mission expansion increases low-quality submission volume | Medium | High | Use structured formats and review discipline |
| Homepage or community reframing makes legacy users feel their favorite systems are being sidelined | Medium | High | Preserve visible support for minigames and driver betting while broadening participation pathways |

---

## Dependencies & Blockers

**Dependencies:**
- Agreement that the protected economy layer remains stable in Phase 1
- Agreement on contribution categories for missions and community structure
- Clear definition of recognition criteria for badges/roles/labels
- Clear mapping from projects to rooms, missions, and contribution opportunities

**Known Blockers:**
- Existing user sensitivity around perceived fairness and economic consistency
- Current platform structure still leans toward broad feature exposure over contribution-guided participation

---

## Appendix

### Glossary
- **Protected economy layer**: Wallet, balances, minigame reward trust, driver betting trust, and other socially sensitive systems that should not be changed abruptly
- **Non-economic recognition**: Badges, roles, contribution history, or visibility that reward participation without inflating currency
- **Contribution ladder**: A structured path from casual participation to deeper project support or building

### References
- `docs/community-economy-governance-policy.md`
- `docs/gps-community-platform-next-phase-prd.md`
- `docs/gps-community-platform-roadmap.md`

---

*This PRD is intentionally conservative. Its purpose is to improve participation quality and contribution depth while preserving trust in the current community economy.*
