# Guia de Instruções para Projeto Full Stack

Este documento detalha as melhores práticas e bibliotecas recomendadas para a construção de um projeto Full Stack robusto, com foco em **Front-end (React)** e **Back-end (Node.js com PostgreSQL)**, incluindo segurança de senhas e animações 3D.

## 1. Back-end (Node.js com PostgreSQL)

Para o back-end, a organização do código é crucial para a manutenibilidade e escalabilidade. Recomenda-se uma estrutura modular e bem definida.

### 1.1. Estrutura de Pastas Recomendada

Uma estrutura de pastas comum e eficaz para projetos Node.js com Express (ou similar) e PostgreSQL segue o princípio de separação de responsabilidades:

```
src/
├── config/             # Configurações do ambiente, banco de dados, etc.
├── controllers/        # Lógica de negócio e manipulação de requisições/respostas
├── models/             # Definição dos modelos de dados (ex: Sequelize, TypeORM)
├── routes/             # Definição das rotas da API
├── services/           # Lógica de negócio complexa, abstração de modelos
├── middlewares/        # Funções intermediárias (autenticação, validação)
├── utils/              # Funções utilitárias diversas
├── app.js              # Configuração principal da aplicação (Express)
└── server.js           # Ponto de entrada para iniciar o servidor
```

**Explicação:**

*   **`config/`**: Armazena arquivos de configuração para diferentes ambientes (desenvolvimento, produção), variáveis de ambiente, configurações de banco de dados, etc.
*   **`controllers/`**: Contém a lógica para lidar com as requisições HTTP, interagir com os serviços e enviar as respostas. Cada arquivo geralmente corresponde a um recurso (ex: `UserController.js`).
*   **`models/`**: Define a estrutura dos dados e a interação com o banco de dados. Se estiver usando um ORM como Sequelize ou TypeORM, os modelos seriam definidos aqui.
*   **`routes/`**: Define os endpoints da API e mapeia-os para os controladores correspondentes. É comum ter um arquivo de rota por recurso (ex: `userRoutes.js`).
*   **`services/`**: Contém a lógica de negócio mais complexa e reutilizável. Os controladores chamam os serviços, que por sua vez interagem com os modelos. Isso ajuda a manter os controladores leves e focados apenas na manipulação de requisições.
*   **`middlewares/`**: Funções que são executadas antes ou depois das rotas, como autenticação, validação de dados, tratamento de erros, etc.
*   **`utils/`**: Funções auxiliares que podem ser usadas em várias partes da aplicação, como formatadores de data, validadores genéricos, etc.
*   **`app.js`**: Onde a aplicação Express é configurada, incluindo middlewares globais e a montagem das rotas.
*   **`server.js`**: O ponto de entrada que inicia o servidor HTTP e escuta em uma porta específica.

### 1.2. Segurança de Senhas (Criptografia)

Para a segurança das senhas, é fundamental **nunca armazená-las em texto puro**. As senhas devem ser _hash_ com algoritmos robustos e lentos para dificultar ataques de força bruta e dicionário. As bibliotecas mais recomendadas para Node.js são:

*   **Bcrypt**: Amplamente utilizada e considerada segura. É um algoritmo de _hashing_ de senha adaptável, o que significa que pode ser tornado mais lento ao longo do tempo para resistir a ataques de hardware mais rápidos [1].
    *   **Instalação:** `npm install bcrypt` ou `yarn add bcrypt`
    *   **Exemplo de Uso:**
        ```javascript
        const bcrypt = require('bcrypt');
        const saltRounds = 10; // Custo computacional, quanto maior, mais seguro e mais lento

        // Hash da senha
        bcrypt.hash('minhaSenhaSecreta', saltRounds, function(err, hash) {
            if (err) { /* lidar com erro */ }
            console.log(hash); // Armazene este hash no banco de dados
        });

        // Comparar senha
        bcrypt.compare('minhaSenhaSecreta', hashArmazenado, function(err, result) {
            if (err) { /* lidar com erro */ }
            if (result) {
                console.log('Senha correta!');
            } else {
                console.log('Senha incorreta.');
            }
        });
        ```

*   **Argon2**: Considerado o algoritmo de _hashing_ de senha mais moderno e seguro, vencedor do Password Hashing Competition. Ele oferece proteção contra ataques de força bruta e também contra ataques de memória [2].
    *   **Instalação:** `npm install argon2` ou `yarn add argon2`
    *   **Exemplo de Uso:**
        ```javascript
        const argon2 = require('argon2');

        // Hash da senha
        async function hashPassword(password) {
            try {
                const hash = await argon2.hash(password);
                return hash;
            } catch (err) {
                // lidar com erro
            }
        }

        // Comparar senha
        async function verifyPassword(hash, password) {
            try {
                if (await argon2.verify(hash, password)) {
                    console.log('Senha correta!');
                } else {
                    console.log('Senha incorreta.');
                }
            } catch (err) {
                // lidar com erro
            }
        }
        ```

**Recomendação:** Embora Bcrypt seja amplamente utilizado, **Argon2 é a recomendação atual da OWASP** para _hashing_ de senhas devido à sua maior resistência a ataques avançados [3].

## 2. Front-end (React)

Para o front-end com React, uma estrutura de pastas bem organizada facilita o desenvolvimento, a manutenção e a escalabilidade do projeto.

### 2.1. Estrutura de Pastas Recomendada

Uma abordagem comum é organizar por **recursos (features)** ou por **tipos de arquivos (components, hooks, pages)**. A organização por recursos é geralmente preferida para projetos maiores, pois agrupa tudo o que está relacionado a uma funcionalidade específica em um único local.

```
src/
├── assets/             # Imagens, ícones, fontes, etc.
├── components/         # Componentes reutilizáveis e genéricos (botões, modais, etc.)
├── contexts/           # Contextos React para gerenciamento de estado global
├── hooks/              # Custom Hooks reutilizáveis
├── pages/              # Componentes de página (rotas principais)
├── services/           # Funções para chamadas de API, lógica de comunicação com o backend
├── styles/             # Arquivos de estilo globais ou variáveis CSS
├── utils/              # Funções utilitárias diversas
├── App.js              # Componente principal da aplicação
└── index.js            # Ponto de entrada da aplicação
```

**Explicação:**

*   **`assets/`**: Contém todos os recursos estáticos como imagens, ícones, fontes, etc.
*   **`components/`**: Armazena componentes React reutilizáveis que não estão diretamente ligados a uma rota específica. Pense em elementos de UI como botões, cards, modais, etc.
*   **`contexts/`**: Para gerenciamento de estado global usando a API de Contexto do React.
*   **`hooks/`**: Contém _custom hooks_ que encapsulam lógica reutilizável e com estado.
*   **`pages/`**: Componentes que representam as diferentes páginas ou rotas da aplicação. Cada arquivo aqui geralmente corresponde a uma rota principal (ex: `HomePage.js`, `LoginPage.js`).
*   **`services/`**: Funções responsáveis por fazer chamadas de API para o back-end, abstraindo a lógica de comunicação.
*   **`styles/`**: Arquivos de estilo globais, variáveis CSS, ou configurações de frameworks CSS (ex: Tailwind CSS).
*   **`utils/`**: Funções utilitárias que podem ser usadas em várias partes do front-end.
*   **`App.js`**: O componente raiz da aplicação, onde as rotas são geralmente configuradas.
*   **`index.js`**: O ponto de entrada principal que renderiza o componente `App` no DOM.

### 2.2. Boas Práticas para Organização de Dados e Rotas

*   **Separação de Preocupações (Separation of Concerns)**: Mantenha a lógica de apresentação, lógica de negócio e lógica de dados em arquivos e módulos separados. Isso torna o código mais fácil de entender, testar e manter.
*   **Organização por Recurso (Feature-based)**: Para projetos maiores, considere agrupar componentes, hooks, estilos e serviços relacionados a uma funcionalidade específica em uma única pasta de recurso (ex: `features/UserManagement/`, `features/ProductCatalog/`).
*   **Rotas Declarativas**: Utilize bibliotecas de roteamento como `React Router` para definir rotas de forma declarativa, o que melhora a legibilidade e a manutenção.
*   **Gerenciamento de Estado**: Escolha uma estratégia de gerenciamento de estado (Context API, Redux, Zustand, Recoil) e siga suas melhores práticas para organizar o estado da aplicação.

### 2.3. Bibliotecas de Animação 3D e Transição de Imagens

Para criar experiências visuais dinâmicas com animações 3D e transições de imagens no React, as seguintes bibliotecas são altamente recomendadas:

*   **Three.js / React-three-fiber**:
    *   **Three.js** é uma biblioteca JavaScript de baixo nível para criar e exibir gráficos 3D no navegador usando WebGL. É extremamente poderosa e flexível [4].
    *   **React-three-fiber** é um _renderer_ para Three.js no React, permitindo que você construa cenas 3D com componentes React. Simplifica muito o trabalho com Three.js em um ambiente React, aproveitando o sistema de componentes e o gerenciamento de estado do React [5].
    *   **Uso:** Ideal para criar experiências 3D complexas, visualizações de dados interativas, jogos e modelos 3D.

*   **Framer Motion**: Uma biblioteca de animação de produção para React, focada em animações de interface de usuário. É fácil de usar e muito poderosa para animações de elementos, gestos, layouts e transições de página [6].
    *   **Uso:** Perfeita para animações de UI, microinterações, transições suaves entre componentes e layouts, e animações baseadas em gestos.

*   **React Spring**: Uma biblioteca de animação baseada em física que torna as animações naturais e interativas. É mais flexível que as animações baseadas em duração e é excelente para transições fluidas e animações complexas [7].
    *   **Uso:** Ótima para animações de UI com comportamento mais natural, transições de estado e animações que respondem a interações do usuário.

*   **GSAP (GreenSock Animation Platform)**: Uma biblioteca de animação JavaScript de alto desempenho e agnóstica a frameworks. Embora não seja específica do React, pode ser integrada e é conhecida por sua robustez e capacidade de animar qualquer propriedade CSS, SVG, Canvas, WebGL, etc. [8].
    *   **Uso:** Para animações de linha do tempo complexas, animações de alto desempenho e controle preciso sobre cada aspecto da animação.

*   **React Transition Group**: Uma biblioteca que ajuda a gerenciar estados de montagem/desmontagem de componentes, facilitando a aplicação de transições e animações quando componentes entram ou saem do DOM [9].
    *   **Uso:** Essencial para transições de entrada/saída de componentes e páginas, permitindo que você adicione classes CSS para animar a aparência e o desaparecimento.

## Referências

[1] Bcrypt - Wikipedia: https://en.wikipedia.org/wiki/Bcrypt
[2] Argon2 - Wikipedia: https://en.wikipedia.org/wiki/Argon2
[3] OWASP Cheat Sheet Series - Password Storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[4] Three.js: https://threejs.org/
[5] React-three-fiber: https://docs.pmnd.rs/react-three-fiber/getting-started/introduction
[6] Framer Motion: https://www.framer.com/motion/
[7] React Spring: https://www.react-spring.dev/
[8] GreenSock Animation Platform (GSAP): https://greensock.com/gsap/
[9] React Transition Group: https://reactcommunity.org/react-transition-group/
