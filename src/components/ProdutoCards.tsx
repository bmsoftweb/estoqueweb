import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImageOff, Loader2, Package, Tag } from 'lucide-react';
import { ProdutoPesquisa } from '../types';
import { miniaturaFoto } from '../services/api';
import { formatCurrencyBRL, formatQtd } from '../utils/formatters';

interface ProdutoCardsProps {
  produtos: ProdutoPesquisa[];
  selecionado: ProdutoPesquisa | null;
  podeEditar: boolean;
  podePromocao: boolean;
  onSelecionar: (p: ProdutoPesquisa) => void;
  onVerFotos: (p: ProdutoPesquisa) => void;
  /** Campo de quantidade do pré-pedido, o mesmo da visão em lista */
  renderPedido: (p: ProdutoPesquisa) => React.ReactNode;
}

/** Visão de vitrine (estilo e-commerce) da pesquisa de estoque */
export const ProdutoCards: React.FC<ProdutoCardsProps> = ({
  produtos,
  selecionado,
  podeEditar,
  podePromocao,
  onSelecionar,
  onVerFotos,
  renderPedido,
}) => (
  <div className="p-4 grid gap-3 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
    {produtos.map((p) => {
      const ativo = selecionado?.id === p.id && selecionado?.idRef === p.idRef;
      const semEstoque = p.disponivel <= 0;
      const temPromocao = podePromocao && p.emPromocao && p.promocao !== null;
      return (
        <div
          key={`${p.id}-${p.idRef}`}
          onClick={() => onSelecionar(p)}
          className={`group flex flex-col bg-white dark:bg-stone-900 border transition-all cursor-pointer overflow-hidden ${
            ativo
              ? 'border-blue-500 ring-2 ring-blue-500/30'
              : 'border-stone-200 dark:border-stone-800 hover:shadow-lg hover:border-stone-300 dark:hover:border-stone-700'
          }`}
        >
          {/* Foto */}
          <div className="relative aspect-square overflow-hidden bg-stone-50 dark:bg-stone-950 flex items-center justify-center">
            {p.fotoPrincipal ? (
              <Miniatura idFoto={p.fotoPrincipal} alt={p.descricao} />
            ) : (
              <Package className="w-12 h-12 text-stone-200 dark:text-stone-700" />
            )}

            {p.fotos > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onVerFotos(p);
                }}
                title={`Ver ${p.fotos} foto(s)`}
                className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-white/90 dark:bg-stone-800/90 text-stone-700 dark:text-stone-200 border border-stone-200 dark:border-stone-700 hover:text-blue-600 cursor-pointer"
              >
                <Camera className="w-3 h-3" /> {p.fotos}
              </button>
            )}

            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {temPromocao && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-600 text-white">
                  <Tag className="w-3 h-3" /> PROMOÇÃO
                </span>
              )}
              {semEstoque && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-600 text-white">SEM ESTOQUE</span>
              )}
            </div>
          </div>

          {/* Dados */}
          <div className="flex-1 flex flex-col gap-1 p-3 border-t border-stone-100 dark:border-stone-800">
            <div className="text-[10px] text-stone-400 uppercase tracking-wide truncate" title={p.descricaoClasse}>
              {p.marca || p.descricaoClasse || '—'}
            </div>
            <div
              className="text-xs font-medium text-stone-800 dark:text-stone-100 leading-snug line-clamp-2 min-h-[2.5em]"
              title={p.descricao}
            >
              {p.descricao}
            </div>

            {podeEditar && (
              <div className="mt-1">
                {temPromocao ? (
                  <>
                    <div className="text-[11px] text-stone-400 line-through">{formatCurrencyBRL(p.precoVenda ?? 0)}</div>
                    <div className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 leading-tight">
                      {formatCurrencyBRL(p.promocao ?? 0)}
                    </div>
                  </>
                ) : (
                  <div className="text-lg font-semibold text-stone-900 dark:text-stone-50 leading-tight">
                    {formatCurrencyBRL(p.precoVenda ?? 0)}
                  </div>
                )}
                <div className="text-[10px] text-stone-400">por {p.un || 'unidade'}</div>
              </div>
            )}

            <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-[11px]">
              <span className={`font-bold ${semEstoque ? 'text-rose-600 dark:text-rose-400' : 'text-blue-700 dark:text-blue-400'}`}>
                {formatQtd(p.disponivel)} {p.un} disp.
              </span>
              <span className="font-mono text-stone-400">#{p.id}</span>
            </div>

            {podeEditar && (
              <div
                className="flex items-center justify-between gap-2 pt-2 border-t border-stone-100 dark:border-stone-800"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Pré-pedido</span>
                {renderPedido(p)}
              </div>
            )}
          </div>
        </div>
      );
    })}
  </div>
);

/** Miniatura baixada só quando o card aparece na tela */
const Miniatura: React.FC<{ idFoto: number; alt: string }> = ({ idFoto, alt }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisivel(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visivel) return;
    let vivo = true;
    miniaturaFoto(idFoto)
      .then((u) => vivo && setUrl(u))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [visivel, idFoto]);

  return (
    // Absoluto: a foto não estica o quadro; w/h-full + contain amplia as pequenas sem distorcer
    <div ref={ref} className="absolute inset-0 flex items-center justify-center p-3">
      {url ? (
        <img src={url} alt={alt} className="w-full h-full object-contain transition-transform group-hover:scale-105" />
      ) : falhou ? (
        <ImageOff className="w-8 h-8 text-stone-300" />
      ) : (
        <Loader2 className="w-5 h-5 animate-spin text-stone-300" />
      )}
    </div>
  );
};
