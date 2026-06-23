import React, { useRef } from 'react';

// Contêiner de tabela com UMA barra de rolagem horizontal (na base, sempre visível).
// maxHeight usa calc(100vh - offset) para a tabela nunca ultrapassar a viewport,
// garantindo que o scrollbar horizontal apareça sem precisar rolar a página.
const TableScroll: React.FC<{ children: React.ReactNode; maxHeight?: number | string; className?: string }> = ({ children, maxHeight, className }) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  // Altura padrão: ocupa a viewport menos ~280px de header/tabs/padding
  const h = maxHeight ?? 'calc(100vh - 280px)';

  return (
    <div className={className}>
      <div ref={bodyRef} className="overflow-auto" style={{ maxHeight: h }}>
        {children}
      </div>
    </div>
  );
};

export default TableScroll;
