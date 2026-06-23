
export enum TicketStatus {
  OPEN = 'Aberto',
  IN_PROGRESS = 'Em Atendimento',
  PENDING = 'Aguardando Usuário',
  IN_VALIDATION = 'Em Validação',
  WAITING_SUPPORT = 'Aguardando Suporte',
  CLOSED = 'Concluído',
  CANCELLED = 'Cancelado'
}

export enum TicketPriority {
  LOW = 'Baixa',
  MEDIUM = 'Média',
  HIGH = 'Alta',
  URGENT = 'Urgente',
  NOT_DEFINED = 'Não Definida'
}

export enum TicketCategory {
  DASHBOARD_REPORT = 'Novo dashboard / relatório',
  AUTOMATION = 'Criar automação',
  FIELD_SUGGESTION = 'Sugestão e inclusão de campo',
  ERROR_FIX = 'Ajuste de erro ou problema',
  STARSOFT = 'StarSoft',
  INFRASTRUCTURE = 'Infraestrutura'
}

export type UserRole = 'super_user' | 'admin' | 'user' | 'ceo' | 'externo';

export interface NotificationPreferences {
  email: boolean;
  sound: boolean;
  desktop: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  sector?: string;
  managed_sectors?: string; // Comma or Semicolon separated list
  last_login?: string; // ISO Date string
  permissions?: {
    [module: string]: {
      can_view?: boolean;
      view_all_sectors?: boolean;
      can_edit?: boolean;
      can_delete?: boolean;
      allowed_sectors?: string[];
      sector_mode?: string; // 'include' | 'exclude'
    };
  };
  notification_preferences?: NotificationPreferences;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  link?: string;
  is_read: boolean;
  created_at: string;
}

export interface ActionPlanSubItem {
  id: string;
  actions: string;
  expectedResult: string;
  projects: string;
  responsible: string[];
  status: 'Não Iniciado' | 'Em Andamento' | 'Atrasado' | 'Concluído' | 'Suspenso';
  scheduleStart: string;
  scheduleEnd: string;
  observation?: string; // Novo campo solicitado
  budgetPlanned?: number;
  budgetActual?: number;
  hoursPlanned?: number;
  hoursActual?: number;
  roiPercentage?: number;
  stakeholderSatisfaction?: number;
  riskLevel?: string;
  waitingForReturn?: string[]; // Aguardando Retorno (User IDs or Names)
  blockedByUserId?: string; // ID do usuário que está bloqueando
  createdByName?: string;
  createdAt?: string;
  updatedByName?: string;
  updatedAt?: string;
  attachments?: {
    id: string;
    file_name: string;
    file_path: string;
    file_size?: number;
    created_at: string;
    uploaded_by?: string;
  }[];
}

export interface ActionPlanItem {
  id: string;
  sector: string;
  objective: string; // Tema Principal
  macro_theme?: string; // CLI, PIP, PAC
  subItems: ActionPlanSubItem[]; // Lista de subtemas/ações vinculadas
}

export interface TicketUpdate {
  id: string;
  userId: string;
  userName: string;
  message: string;
  createdAt: string;
  isSystem?: boolean;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  requesterId: string;
  requesterName: string;
  requester_sector?: string;
  assignedTo?: string;
  assigned_to?: string; // Backend field (snake_case)
  assignedName?: string;
  subcategory?: string; // Backend field
  createdAt: string;
  created_at?: string; // Backend field
  updatedAt: string;
  deliveryForecast?: string;
  delivery_forecast?: string; // Backend field (snake_case)
  updates: TicketUpdate[];
}
