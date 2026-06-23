import React from 'react';
import { useNavigate } from 'react-router-dom';
import './StrategicMap.css';

const StrategicMap: React.FC<{ user: any }> = ({ user }) => {
    const navigate = useNavigate();

    const handleBoxClick = (objectiveName: string) => {
        navigate('/strategic-timeline', { state: { expandObjective: objectiveName } });
    };

    return (
        <div className="w-full h-full overflow-auto bg-gray-100 flex flex-col items-center">
            {/* Main Canvas - Fixed 16:9 Aspect Ratio Container */}
            <div className="strategic-map-container bg-white shadow-2xl relative">

                {/* Header */}
                <div className="h-[100px] w-full bg-white flex justify-end items-center pr-12 pt-8 relative z-20">
                    <div className="flex flex-col items-end mr-[60px] bg-white z-20">
                        <h1 className="text-5xl font-black text-[#E1251B] italic tracking-tighter" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
                            3LACKD
                        </h1>
                        <p className="text-[#E1251B] text-sm font-semibold tracking-wide">
                            Detalhes que fazem a diferença.
                        </p>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex w-full" style={{ height: 'calc(100% - 100px)' }}>
                    {/* Lanes */}
                    <div className="flex-1 flex flex-col pt-1">

                        {/* PAC Lane */}
                        <div className="h-[26%] bg-gray-50 flex items-center justify-evenly px-4 relative z-0">
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Avaliação de Desempenho')}>Avaliação de Desempenho</div>
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Marketing da Empresa')}>Marketing da Empresa</div>
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Mudança de Cultura Hierárquica para resultado e aprendizagem')}>Mudança de Cultura Hierárquica para resultado e aprendizagem</div>
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Captar Talentos (cargos chaves)')}>Captar Talentos (cargos chaves)</div>
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Desenvolver e Reter Talentos')}>Desenvolver e Reter Talentos</div>
                            <div className="map-box flex-box bg-pac box-pac" onClick={() => handleBoxClick('Desenvolver Lideranças')}>Desenvolver Lideranças</div>
                        </div>

                        {/* PIP Lane */}
                        <div className="h-[28%] bg-white px-2 relative z-10 flex flex-col justify-center py-2">
                            <div className="grid-pip h-full">
                                {/* Top Row */}
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 2, gridRow: 1 }} onClick={() => handleBoxClick('Engº de Produção/Analista de Planejamento')}>Engº de Produção/Analista de Planejamento</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 4, gridRow: 1 }} onClick={() => handleBoxClick('Ação sobre Não Conformidades')}>Ação sobre Não Conformidades</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 6, gridRow: 1 }} onClick={() => handleBoxClick('Aumentar a presença em Marketplace estratégicos')}>Aumentar a presença em Marketplace estratégicos</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 8, gridRow: 1 }} onClick={() => handleBoxClick('Implantar planejamento de manutenções')}>Implantar planejamento de manutenções</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 10, gridRow: 1 }} onClick={() => handleBoxClick('Lançamento da linha de produtos recicláveis')}>Lançamento da linha de produtos recicláveis</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 12, gridRow: 1 }} onClick={() => handleBoxClick('Agilizar lançamento de produtos')}>Agilizar lançamento de produtos</div>

                                {/* Bottom Row */}
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 1, gridRow: 2 }} onClick={() => handleBoxClick('Estoque Exclusivo para ecommerce')}>Estoque Exclusivo para ecommerce</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 3, gridRow: 2 }} onClick={() => handleBoxClick('Implementar ações de Social Commerce')}>Implementar ações de Social Commerce</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 5, gridRow: 2 }} onClick={() => handleBoxClick('Sustentabilidade / Redução de desperdício')}>Sustentabilidade / Redução de desperdício</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 7, gridRow: 2 }} onClick={() => handleBoxClick('Aumentar a venda com frete CIF')}>Aumentar a venda com frete CIF</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 9, gridRow: 2 }} onClick={() => handleBoxClick('Melhorar a comunicação no PDV')}>Melhorar a comunicação no PDV</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 11, gridRow: 2 }} onClick={() => handleBoxClick('Desenvolver parcerias para novos produtos')}>Desenvolver parcerias para novos produtos</div>
                                <div className="map-box flex-box bg-pip self-start" style={{ gridColumn: 13, gridRow: 2 }} onClick={() => handleBoxClick('Desenhar e aprimorar os processos internos')}>Desenhar e aprimorar os processos internos</div>
                            </div>
                        </div>

                        {/* CLI Lane */}
                        <div className="h-[28%] bg-gray-50 px-8 relative z-10 flex flex-col justify-center py-2">
                            <div className="grid-cli h-full">
                                {/* Top Row */}
                                <div className="map-box flex-box bg-cli self-end" style={{ gridColumn: 2, gridRow: 1 }} onClick={() => handleBoxClick('Rever política comercial ecommerce x varejo')}>Rever política comercial ecommerce x varejo</div>
                                <div className="map-box flex-box bg-cli self-end" style={{ gridColumn: 4, gridRow: 1 }} onClick={() => handleBoxClick('Produto exclusivo para ecommerce')}>Produto exclusivo para ecommerce</div>
                                <div className="map-box flex-box bg-cli self-end" style={{ gridColumn: 6, gridRow: 1 }} onClick={() => handleBoxClick("Aumentar a presença em Home Center's")}>Aumentar a presença em Home Center's</div>
                                <div className="map-box flex-box bg-cli self-end" style={{ gridColumn: 8, gridRow: 1 }} onClick={() => handleBoxClick('Aumentar o numero de distribuidores')}>Aumentar o numero de distribuidores</div>
                                <div className="map-box flex-box bg-cli self-end" style={{ gridColumn: 10, gridRow: 1 }} onClick={() => handleBoxClick('Reestruturação da Equipe Comercial')}>Reestruturação da Equipe Comercial</div>

                                {/* Bottom Row */}
                                <div className="map-box flex-box bg-cli self-start" style={{ gridColumn: 1, gridRow: 2 }} onClick={() => handleBoxClick('Exportação de produtos para B2C na América Latina')}>Exportação de produtos para B2C na América Latina</div>
                                <div className="map-box flex-box bg-cli self-start" style={{ gridColumn: 3, gridRow: 2 }} onClick={() => handleBoxClick('Aumentar o volume de vendas em Acessibilidade (blindar)')}>Aumentar o volume de vendas em Acessibilidade (blindar)</div>
                                <div className="map-box flex-box bg-cli self-start" style={{ gridColumn: 5, gridRow: 2 }} onClick={() => handleBoxClick('Positivar mais clientes B2B')}>Positivar mais clientes B2B</div>
                                <div className="map-box flex-box bg-cli self-start" style={{ gridColumn: 7, gridRow: 2 }} onClick={() => handleBoxClick('Calendário de Ações Com. (Copa do Mundo)')}>Calendário de Ações Com. (Copa do Mundo)</div>
                                <div className="map-box flex-box bg-cli self-start" style={{ gridColumn: 9, gridRow: 2 }} onClick={() => handleBoxClick('Aumentar a presença nacional (redes)')}>Aumentar a presença nacional (redes)</div>
                            </div>
                        </div>

                        {/* FIN Lane */}
                        <div className="h-[18%] bg-white flex items-center justify-center gap-16 relative z-0 px-20">
                            <div className="map-box flex-box bg-fin box-fin" onClick={() => handleBoxClick('Análise do nosso conta corrente tributário')}>Análise do nosso conta corrente tributário</div>
                            <div className="map-box flex-box bg-fin box-fin" onClick={() => handleBoxClick('Redução de custos')}>Redução de custos</div>
                            <div className="map-box flex-box bg-fin box-fin" onClick={() => handleBoxClick('Aumentar Rentabilidade')}>Aumentar Rentabilidade</div>
                        </div>

                    </div>

                    {/* Right Labels Sidebar */}
                    <div className="w-[45px] flex flex-col font-black text-sm text-white tracking-widest leading-none">
                        <div className="h-[26%] bg-[#ea0061] flex items-center justify-center border-b-[2px] border-white text-[10px]">
                            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>PAC</span>
                        </div>
                        <div className="h-[28%] bg-[#1da0cc] flex items-center justify-center border-b-[2px] border-white text-[10px]">
                            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>PIP</span>
                        </div>
                        <div className="h-[28%] bg-[#ef5a24] flex items-center justify-center border-b-[2px] border-white text-[10px]">
                            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>CLI</span>
                        </div>
                        <div className="h-[18%] bg-[#83229b] flex items-center justify-center text-[10px]">
                            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>FIN</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default StrategicMap;
