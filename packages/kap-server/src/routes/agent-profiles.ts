/**
 * `/agent-profiles` route — server-v2 port.
 *
 *   GET /agent-profiles   data: { profiles: AgentProfile[] }
 *
 * Lists the available agent profiles (name, description, whenToUse) backed by
 * the App-scope `IAgentProfileCatalogService`, projected into the v1 wire
 * snake_case shape. Purely a read-only enumeration — profile switching itself
 * goes through the per-session prompt / agent RPC path.
 */

import {
  IAgentProfileCatalogService,
  type Scope,
} from '@moonshot-ai/agent-core-v2';

import { okEnvelope } from '../envelope';
import { defineRoute } from '../middleware/defineRoute';
import {
  listAgentProfilesResponseSchema,
  type AgentProfileInfo,
} from '../protocol/rest-agent-profile';

interface AgentProfilesRouteHost {
  get(
    path: string,
    options: { schema?: Record<string, unknown> },
    handler: (
      req: { id: string },
      reply: { send(payload: unknown): void },
    ) => Promise<void> | void,
  ): void;
}

export function registerAgentProfilesRoutes(app: AgentProfilesRouteHost, core: Scope): void {
  const getRoute = defineRoute(
    {
      method: 'GET',
      path: '/agent-profiles',
      success: { data: listAgentProfilesResponseSchema },
      description: 'List the available agent profiles',
      tags: ['agent-profiles'],
    },
    async (req, reply) => {
      const catalog = core.accessor.get(IAgentProfileCatalogService);
      const profiles: AgentProfileInfo[] = catalog.list().map((profile) => ({
        name: profile.name,
        description: profile.description,
        when_to_use: profile.whenToUse,
      }));
      reply.send(okEnvelope({ profiles }, req.id));
    },
  );
  app.get(getRoute.path, getRoute.options, getRoute.handler as Parameters<AgentProfilesRouteHost['get']>[2]);
}