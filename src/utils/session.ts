import { Empresa, ServidorInfo, Usuario } from '../types';

/**
 * Sessão do EstoqueWEB e opção "Lembrar neste dispositivo" (mesmo padrão do b2b admin).
 *
 * - Marcada: o token fica no localStorage e o servidor e o e-mail vêm preenchidos no
 *   próximo login (o Delphi guardava usuário e senha em cookie; aqui a senha nunca é guardada).
 * - Desmarcada: o token fica no sessionStorage e termina ao fechar o navegador.
 *
 * O número do servidor é sempre lembrado: costuma ser o mesmo em todo acesso do dispositivo.
 */

const SESSAO = 'estoqueweb_sessao';
const LEMBRETE = 'estoqueweb_lembrar_email';
const SERVIDOR = 'estoqueweb_ultimo_servidor';

export interface SessaoSalva {
  token: string;
  usuario: Usuario;
  empresa: Empresa;
  servidor: ServidorInfo;
}

function seguro<T>(fn: () => T, padrao: T): T {
  try {
    return fn();
  } catch {
    return padrao;
  }
}

export function lerSessao(): SessaoSalva | null {
  return seguro(() => {
    const bruto = localStorage.getItem(SESSAO) ?? sessionStorage.getItem(SESSAO);
    const sessao = bruto ? (JSON.parse(bruto) as SessaoSalva) : null;
    // Sessões anteriores ao cadastro de servidores não servem mais
    return sessao?.servidor ? sessao : null;
  }, null);
}

export function salvarSessao(sessao: SessaoSalva, lembrar: boolean) {
  seguro(() => {
    const destino = lembrar ? localStorage : sessionStorage;
    const outro = lembrar ? sessionStorage : localStorage;
    destino.setItem(SESSAO, JSON.stringify(sessao));
    outro.removeItem(SESSAO);
  }, undefined);
}

/** Atualiza a sessão no armazenamento onde ela já está */
export function atualizarSessao(parcial: Partial<SessaoSalva>) {
  seguro(() => {
    for (const s of [localStorage, sessionStorage]) {
      const bruto = s.getItem(SESSAO);
      if (bruto) s.setItem(SESSAO, JSON.stringify({ ...JSON.parse(bruto), ...parcial }));
    }
  }, undefined);
}

export function limparSessao() {
  seguro(() => {
    localStorage.removeItem(SESSAO);
    sessionStorage.removeItem(SESSAO);
  }, undefined);
}

export function lerLembrete(): string | null {
  return seguro(() => localStorage.getItem(LEMBRETE), null);
}

export function salvarLembrete(email: string) {
  seguro(() => localStorage.setItem(LEMBRETE, email), undefined);
}

export function limparLembrete() {
  seguro(() => localStorage.removeItem(LEMBRETE), undefined);
}

export function lerUltimoServidor(): string {
  return seguro(() => localStorage.getItem(SERVIDOR) || '', '');
}

export function salvarUltimoServidor(numero: number) {
  seguro(() => localStorage.setItem(SERVIDOR, String(numero)), undefined);
}
