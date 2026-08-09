import { z } from 'zod';

export const agentProfileInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  when_to_use: z.string().optional(),
});
export type AgentProfileInfo = z.infer<typeof agentProfileInfoSchema>;

export const listAgentProfilesResponseSchema = z.object({
  profiles: z.array(agentProfileInfoSchema),
});
export type ListAgentProfilesResponse = z.infer<typeof listAgentProfilesResponseSchema>;