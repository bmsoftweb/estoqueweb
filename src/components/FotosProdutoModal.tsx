import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Loader2 } from 'lucide-react';
import { FotoProduto, ProdutoPesquisa } from '../types';
import { baixarFotoProduto, fetchFotosProduto } from '../services/api';
import { MensagemErro, Modal } from './Modal';

/** Fotos do produto (PROFOTOS), como o painel de fotos do frmPesquisa do Delphi */
export const FotosProdutoModal: React.FC<{ produto: ProdutoPesquisa; onClose: () => void }> = ({ produto, onClose }) => {
  const [fotos, setFotos] = useState<FotoProduto[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [falhas, setFalhas] = useState<Record<number, string>>({});
  const [atual, setAtual] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const criadas = useRef<string[]>([]);

  useEffect(() => {
    let vivo = true;
    fetchFotosProduto(produto.id)
      .then(async (lista) => {
        if (!vivo) return;
        setFotos(lista);
        // Baixa uma a uma: a bmAPI lê cada blob da base
        for (const f of lista) {
          try {
            const url = await baixarFotoProduto(f.id);
            if (!vivo) {
              URL.revokeObjectURL(url);
              return;
            }
            criadas.current.push(url);
            setUrls((u) => ({ ...u, [f.id]: url }));
          } catch (e: any) {
            if (vivo) setFalhas((x) => ({ ...x, [f.id]: e.message }));
          }
        }
      })
      .catch((e) => vivo && setErro(e.message));

    return () => {
      vivo = false;
      criadas.current.forEach((u) => URL.revokeObjectURL(u));
      criadas.current = [];
    };
  }, [produto.id]);

  const total = fotos?.length ?? 0;
  const foto = fotos?.[atual];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!total) return;
      if (e.key === 'ArrowRight') setAtual((i) => (i + 1) % total);
      if (e.key === 'ArrowLeft') setAtual((i) => (i - 1 + total) % total);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [total]);

  const botaoSeta =
    'absolute top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/90 dark:bg-stone-800/90 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-white dark:hover:bg-stone-700 shadow cursor-pointer';

  return (
    <Modal
      titulo={`${total || ''} Foto(s) • ${produto.descricao}`}
      subtitulo={`Código ${produto.id}${foto?.descricao ? ` • ${foto.descricao}` : ''}`}
      onClose={onClose}
      largura="lg"
    >
      {erro && <MensagemErro texto={erro} className="m-4" />}

      {!fotos && !erro && (
        <div className="py-24 flex items-center justify-center gap-2 text-xs text-stone-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando fotos…
        </div>
      )}

      {fotos && total === 0 && (
        <div className="py-24 flex flex-col items-center gap-2 text-stone-400 text-xs">
          <ImageOff className="w-8 h-8" /> Nenhuma foto cadastrada para este produto.
        </div>
      )}

      {foto && (
        <div className="p-4 space-y-3">
          <div className="relative h-[60vh] rounded-xl bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 flex items-center justify-center overflow-hidden">
            {urls[foto.id] ? (
              <img src={urls[foto.id]} alt={foto.descricao || produto.descricao} className="max-w-full max-h-full object-contain" />
            ) : falhas[foto.id] ? (
              <div className="flex flex-col items-center gap-2 text-stone-400 text-xs px-6 text-center">
                <ImageOff className="w-8 h-8" /> {falhas[foto.id]}
              </div>
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-stone-400" />
            )}

            {total > 1 && (
              <>
                <button onClick={() => setAtual((i) => (i - 1 + total) % total)} className={`${botaoSeta} left-3`} title="Foto anterior">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button onClick={() => setAtual((i) => (i + 1) % total)} className={`${botaoSeta} right-3`} title="Próxima foto">
                  <ChevronRight className="w-5 h-5" />
                </button>
                <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-900/70 text-white">
                  {atual + 1} / {total}
                </span>
              </>
            )}
          </div>

          {total > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {fotos.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => setAtual(i)}
                  className={`w-20 h-20 shrink-0 rounded-lg border-2 overflow-hidden bg-stone-50 dark:bg-stone-950 flex items-center justify-center cursor-pointer ${
                    i === atual ? 'border-blue-600' : 'border-stone-200 dark:border-stone-700 hover:border-blue-300'
                  }`}
                >
                  {urls[f.id] ? (
                    <img src={urls[f.id]} alt="" className="w-full h-full object-contain" />
                  ) : falhas[f.id] ? (
                    <ImageOff className="w-4 h-4 text-stone-400" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
