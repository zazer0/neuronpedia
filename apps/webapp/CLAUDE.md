# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

- **Development**:
  - Local DB: `npm run dev:localhost`
  - Demo mode: `npm run dev:demo`
  - Production mode: `npm run dev:prod`
- **Building**:
  - Local DB: `npm run build:localhost`
  - Simple build: `npm run build:simple`
  - Production: `npm run build`
- **Testing**:
  - Unit tests: `npm run test:vitest`
  - E2E tests: `npm run test:playwright`
  - Single test: `npx vitest components/path/to/file.test.tsx`
  - Watch mode: `npm run test:vitest:watch`
- **Linting & Formatting**:
  - Lint: `npm run lint`
  - Fix lint: `npm run lint:fix`
  - Format: `npm run format:write`
  - Type check: `npm run typecheck`

## High-Level Architecture

### Core Stack
- **Next.js 14** with App Router for file-based routing
- **TypeScript** with strict mode and path aliases (`@/`)
- **Prisma ORM** with PostgreSQL + pgvector extension for embeddings
- **NextAuth.js** for authentication (Apple, Google, GitHub, Email providers)
- **TanStack Query** for server state management
- **Tailwind CSS** + Radix UI components via shadcn/ui

### Key Architectural Patterns

#### 1. Source Hierarchy
The app uses a three-tier model organization:
- **Model** → **SourceSet** → **Source** → **SourceRelease**
- This allows versioning and A/B testing of SAE implementations
- Sources can be linked to InferenceHostSource for external compute

#### 2. Provider Architecture
Global state is managed through React Context providers in `components/provider/`:
- `AuthProvider`: User authentication state
- `FeatureProvider`: Current feature/neuron context
- `GlobalProvider`: App-wide settings and data
- `InferenceActivationAllProvider`: Activation data management
- Providers are composed in `providers.tsx`

#### 3. API Route Organization
- `/api/auth/*`: NextAuth endpoints
- `/api/admin/*`: Protected admin operations
- `/api/[entity]/*`: RESTful CRUD operations
- `/api/proxy-*`: External service proxies
- All routes use consistent error handling and return typed responses

#### 4. Database Access Patterns
- All DB operations go through `lib/db/` modules
- Each entity has its own module (e.g., `user.ts`, `neuron.ts`)
- Use of Prisma transactions for complex operations
- pgvector queries for semantic search capabilities

#### 5. Authentication & Authorization
- Custom Prisma adapter for NextAuth
- User secrets system for API key management
- Role-based access control (admin, canTriggerExplanations)
- Path-based rate limiting with Upstash Redis

#### 6. Component Organization
- **Feature modules**: Organized by route (e.g., `app/[modelId]/[layer]/[index]/`)
- **Shared components**: In `components/` with sub-organization
- **Panes**: Reusable sidebar components in `components/panes/`
- **UI primitives**: In `components/shadcn/` following Radix patterns

### Environment Configuration
- `.env.localhost`: Local development with local DB
- `.env.demo`: Demo mode with limited features
- `.env.prod`: Production configuration
- Feature flags control analytics, rate limiting, sign-in requirements

### Testing Strategy
- **Unit tests**: Vitest with React Testing Library
- **E2E tests**: Playwright with separate local/production test suites
- **Test data**: Use `vitest/test-utils.tsx` for mocking
- Tests live alongside components as `*.test.tsx` files

### Key Dependencies & Their Purposes
- **AI/ML**: OpenAI, Anthropic, Google AI for explanations and scoring
- **Visualization**: Plotly.js for UMAP/charts, D3 for graphs
- **Storage**: AWS S3 with presigned URLs for uploads
- **Email**: AWS SES or Resend with MJML templates
- **Monitoring**: Sentry for error tracking
- **MDX**: For blog/documentation with syntax highlighting

### Performance Considerations
- Server Components by default, Client Components when needed
- Dynamic imports for heavy visualization libraries
- Streaming responses for AI completions
- Image optimization with Next.js Image component
- Standalone Docker builds for deployment

### Security Patterns
- CORS configuration in middleware
- API routes check authentication via `withUser` wrapper
- Sensitive operations require admin role
- Rate limiting on expensive operations
- No client-side API keys, all proxied through server