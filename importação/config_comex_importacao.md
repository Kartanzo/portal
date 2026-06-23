# Arquivos de Configuração - Comex / Importação

Os seguintes arquivos no frontend configuram e gerenciam a página de Importação:

1. **`components/Importation.tsx`**: Arquivo principal com a lógica da página, tabelas e dashboards.
2. **`App.tsx`**: Gerencia a rota `/importation` e o controle de acesso (`hasAccess('importation')`).
3. **`components/Sidebar.tsx`**: Configura a exibição no menu lateral sob a seção "Comex".
4. **`app_api.ts`**: Contém as chamadas de API para histórico, cálculos e upload de arquivos.
5. **`role_permissions.json`**: Define as permissões padrão para cada cargo no sistema.
