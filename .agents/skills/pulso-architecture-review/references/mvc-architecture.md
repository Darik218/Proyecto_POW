# Mandatory PULSO backend MVC

## Scope and responsibilities

The agreed structure requires effective `backend/src/models/`, `backend/src/views/`, and `backend/src/controllers/` layers. Retain NestJS feature modules and dependency injection. Complement them with `services/` for use cases, `repositories/` for persistence, and `domain/` for invariants and specialized calculations. Inspect actual implementation before drawing conclusions; the structure in this reference is a requirement, not evidence of compliance.

- **Model:** domain entities and structures consumed by functional modules. Separate domain meaning from input DTO validation, public response contracts, generated Prisma records, and persistence access. Reuse generated types when useful; avoid cloning all Prisma fields, placing HTTP behavior in models, or turning models into repositories.
- **View:** backend presenters, serializers, or transformers that map internal results to stable public JSON contracts. Exclude sensitive fields, preserve documented formats/units, and make the transformations reusable and active in relevant HTTP paths. Vue renders the frontend and does not replace the required backend JSON view layer. Do not add an HTML template engine for this API adaptation.
- **Controller:** NestJS HTTP handlers under the required controller layer, imported and registered in their owning modules. Preserve decorators, validation, authentication, authorization, status codes, cookies, and dependency injection. Delegate use cases to services, which coordinate domain and persistence work; controllers do not query Prisma or implement complex business rules.

## Scoped audit procedure

1. Identify the affected features, endpoints, consumers, and existing user changes. Check required directories and their concrete source files; record missing or placeholder-only layers. Inspect direct dependencies before expanding the scope.
2. **Model:** locate implemented domain representations, their consumers/imports, domain responsibilities, and compatibility with DTOs and Prisma persistence types. Explain any direct coupling, duplication, or missing representation. Type-level consumers are evidence of structure, not runtime verification on their own.
3. **View:** locate presenters/transformers and actual calls. Trace internal results into public JSON fields, including nested data. Check sensitive-field exclusion, serialization, response reuse, and frontend/OpenAPI contract compatibility. A method called `toView` in a service is evidence of existing transformation behavior, not by itself implementation of the agreed `views/` layer.
4. **Controller:** locate functional handlers, decorators, constructor injection, validation/guards, and owning `@Module({ controllers: [...] })` registration. Check service delegation and use of the corresponding output representation. A module-local controller demonstrates HTTP behavior but does not alone satisfy the required `controllers/` organization.
5. **Integration:** follow the relevant path from route registration through guards/DTO validation, controller, application service, domain/model operations, repository/Prisma access, and JSON view to the HTTP response. Verify provider tokens/bindings and module imports/exports. Check responsibility boundaries, unnecessary duplication, new cycles, authorization, historical integrity, and unchanged API contracts.
6. **Verification:** identify existing focused model, presenter, service, module-resolution, and HTTP checks. When authorized, run only checks proportionate to the change; use isolated PostgreSQL for database-writing tests. Record exact commands/results. Test source alone is not proof that a test passed; unexecuted checks remain pending. A full suite is not required for every small change.

A representative return path is repository result → service/domain/model result → backend JSON view → controller HTTP response. A controller or application service may call a presenter, provided it is implemented in the required view layer and its real use is demonstrated. Module wiring must keep exactly one intended handler/provider per responsibility.

## Required evidence

For each finding, record the layer, file and line, relevant symbol/function, and observed dependency or behavior. Use imports, constructor injection, provider/controller registration, call sites, field transformations, and HTTP assertions as appropriate. Mark inference and inspection limits explicitly.

Do not accept `.gitkeep`, empty folders, class names, generated Prisma models, or Vue screens as sufficient evidence of required backend MVC participation. Do not claim that absent presenters imply a proven data leak: inspect actual response fields before making a security finding.

## Compliance classification

| State | Evidence required |
|---|---|
| **No implementado** | No functional implementation of the required layer; absent or placeholder-only directory. |
| **Parcial** | Some relevant responsibility exists, but the agreed layer, wiring, or intended flow participation is incomplete. |
| **Implementado** | The required layer is implemented in the agreed structure and participates in the intended flows; verification may remain pending. |
| **Verificado** | Implementation is supported by concrete dependency/execution-path evidence and relevant successful tests, with scope and remaining limits stated. |

Report each layer independently and identify pending work. Overall MVC compliance requires all three mandatory layers to be implemented and verified for the stated scope. Do not generalize one endpoint's verification to the whole backend. This classification is independent of functional E0–E5 status.

## Future adaptation and acceptance

For a later authorized refactor, propose an incremental feature-by-feature mapping to the required folders. Preserve NestJS modules, injection tokens, guards, endpoints, JSON contracts, IDs, history, and database integrity. Avoid circular imports, parallel duplicate implementations, double registration of controllers, and empty compatibility facades used only to mimic compliance. Document any conflict between folder organization and module boundaries and offer a concrete MVC-compatible alternative.

Apply a scoped MVC check to new backend controllers, domain models, JSON responses, services/repositories, 1RM calculations, progression, recommendations, and statistics. Audit permission alone does not authorize moving files, implementing presenters/models, editing application code, or applying database changes.
