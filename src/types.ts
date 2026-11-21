// Инцидент в том виде, в каком его отдаёт ITSM (character_problems.json).
export interface Incident {
  sysId: string;
  id: string;
  state: string;
  stateEnum: string;
  stateId: number;
  stateReason: string | null;
  stateReasonId: string;
  submitDate: string;
  deadline: string | null;
  completionDate: string | null;
  lastAssignmentToTeamDateTime: string | null;
  header: string;
  description: string;
  shortDescription: string;
  assignedGroupName: string;
  assignedEmployee: string | null;
  assignedEmployeeLogin: string | null;
  initiatorName: string;
  initiatorLogin: string;
  isEffect: boolean;
  isReason: boolean;
  isDouble: boolean;
  isMaster: boolean;
  incType: string;
  serviceTypeId: number;
  serviceType: string;
  priorityId: number;
  priority: string;
  urgencyId: number;
  urgency: string;
  impactId: number;
  impact: string;
  waitingExitDate: string;
  isRootIncident: boolean;
  productName: string;
  productId: string;
  productMasterId: string;
  productUrl: string | null;
  service: string;
  serviceId: string;
  scenarioName: string;
  isNeedUp: boolean | null;
  eliminationType: string | null;
  eliminationTypeId: string | null;
  receivingChannel: string;
  solution: string | null;
}

export interface Letter {
  id: string;
  receivedAt: string;
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
  incidentId: string | null;
  important: boolean;
}

export type EventLevel = 'critical' | 'warn' | 'ok' | 'info';

export interface LiveEvent {
  id: string;
  at: string;
  type:
    | 'critical_new' | 'critical_resolved' | 'coord_assigned' | 'coord_handed_off' | 'reassigned'
    | 'priority_changed' | 'state_changed' | 'deadline_changed' | 'employee_changed' | 'created' | 'removed' | 'mail';
  incidentId: string | null;
  product: string | null;
  text: string;
  level: EventLevel;
  mailId?: string;
  to?: string;
}

export interface Ack {
  by: string;
  at: string;
}

export interface LiveState {
  version: number;
  updatedAt: string;
  serverTime: string;
  incidents: Incident[];
  mail: Letter[];
  acks: Record<string, Ack>;
  events: LiveEvent[];
  error: string | null;
  auto: { enabled: boolean; intervalMs: number; last: string | null };
  meta: { coordGroup: string; teams: string[] };
}
