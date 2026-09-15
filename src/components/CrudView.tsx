import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Loader2,
  Inbox,
  Plus,
  X,
  List,
  FilePlus2,
  FileText,
  SlidersHorizontal,
} from 'lucide-react';
import { FiltroAvancado, RegistroCrud, ResourceDef } from '../types';
import { listRecords, createRecord, updateRecord, deleteRecord } from '../services/api';
import { RecordForm } from './RecordForm';
import { CellValue } from './CellValue';
import { AdvancedSearch } from './AdvancedSearch';
import { ConfirmDialog, MensagemErro } from './Modal';
import { INPUT_CLASS } from '../utils/formStyles';

interface CrudViewProps {
  resource: ResourceDef;
  refreshToken: number;
  createToken: number;
  onToast: (msg: string) => void;
  /** Botões extras por linha, antes de editar/excluir (ex.: planos liberados da loja) */
  extraRowActions?: (row: RegistroCrud) => React.ReactNode;
  /** Conteúdo extra no formulário do registro */
  renderFormExtra?: (values: Record<string, any>) => React.ReactNode;
  /** Botões extras na barra de ferramentas da listagem */
  toolbarExtra?: React.ReactNode;
  /** Chamado após gravar ou excluir */
  onSaved?: () => void;
}

interface AbaRegistro {
  key: string;
  record: RegistroCrud | null;
  titulo: string;
}

const LIST_TAB = 'lista';

const WIDTH_CLASS: Record<string, string> = { xs: 'w-16', sm: 'w-32', md: 'w-48', lg: 'w-80' };

/** Listagem + formulário em abas, dirigidos pelos metadados (mesmo padrão do b2b admin) */
export const CrudView: React.FC<CrudViewProps> = ({
  resource,
  refreshToken,
  createToken,
  onToast,
  extraRowActions,
  renderFormExtra,
  toolbarExtra,
  onSaved,
}) => {
  const listedFields = useMemo(() => resource.fields.filter((f) => f.listed), [resource]);
  const isSearchable = useMemo(() => resource.fields.some((f) => f.searchable), [resource]);
  const temBuscaAvancada = useMemo(() => resource.fields.some((f) => f.filterable), [resource]);

  const [rows, setRows] = useState<RegistroCrud[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState(resource.defaultSort.field);
  const [dir, setDir] = useState<'asc' | 'desc'>(resource.defaultSort.dir);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buscaAvancadaAberta, setBuscaAvancadaAberta] = useState(false);
  const [filtros, setFiltros] = useState<FiltroAvancado[]>([]);
  const [abas, setAbas] = useState<AbaRegistro[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<string>(LIST_TAB);
  const [deleting, setDeleting] = useState<RegistroCrud | null>(null);
  const [isDeletingBusy, setIsDeletingBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const recordId = useCallback((row: RegistroCrud) => String(row[resource.pk]), [resource.pk]);

  const recordLabel = useCallback(
    (row: RegistroCrud) => {
      const raw = row[resource.labelField];
      const texto = raw === null || raw === undefined || raw === '' ? `#${recordId(row)}` : String(raw);
      return texto.length > 28 ? `${texto.slice(0, 28)}…` : texto;
    },
    [resource.labelField, recordId],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await listRecords(resource.name, { page, limit, search, sort, dir, filters: filtros });
      setRows(data.data);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar os registros.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [resource.name, page, limit, search, sort, dir, filtros]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const abrirAbaNovo = useCallback(() => {
    setAbas((prev) =>
      prev.some((a) => a.key === 'novo') ? prev : [...prev, { key: 'novo', record: null, titulo: `Novo ${resource.labelSingular}` }],
    );
    setAbaAtiva('novo');
  }, [resource.labelSingular]);

  const abrirAbaEdicao = useCallback(
    (row: RegistroCrud) => {
      const key = `edit:${recordId(row)}`;
      setAbas((prev) => {
        if (prev.some((a) => a.key === key)) return prev.map((a) => (a.key === key ? { ...a, record: row } : a));
        return [...prev, { key, record: row, titulo: recordLabel(row) }];
      });
      setAbaAtiva(key);
    },
    [recordId, recordLabel],
  );

  const fecharAba = useCallback((key: string) => {
    setAbas((prev) => {
      const idx = prev.findIndex((a) => a.key === key);
      const restantes = prev.filter((a) => a.key !== key);
      setAbaAtiva((atual) => {
        if (atual !== key) return atual;
        if (!restantes.length) return LIST_TAB;
        return restantes[Math.max(0, idx - 1)].key;
      });
      return restantes;
    });
  }, []);

  useEffect(() => {
    if (createToken > 0 && resource.canCreate) abrirAbaNovo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createToken]);

  const handleSort = (fieldName: string) => {
    if (sort === fieldName) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(fieldName);
      setDir('asc');
    }
    setPage(1);
  };

  const handleSave = async (aba: AbaRegistro, payload: RegistroCrud) => {
    if (aba.record) {
      await updateRecord(resource.name, recordId(aba.record), payload);
      onToast(`${resource.labelSingular} atualizado com sucesso.`);
    } else {
      await createRecord(resource.name, payload);
      onToast(`${resource.labelSingular} incluído com sucesso.`);
    }
    fecharAba(aba.key);
    onSaved?.();
    await load();
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeletingBusy(true);
    setDeleteError(null);
    try {
      const id = recordId(deleting);
      await deleteRecord(resource.name, id);
      onToast(`${resource.labelSingular} excluído com sucesso.`);
      setDeleting(null);
      fecharAba(`edit:${id}`);
      onSaved?.();
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      else await load();
    } catch (err: any) {
      setDeleteError(err.message || 'Não foi possível excluir o registro.');
    } finally {
      setIsDeletingBusy(false);
    }
  };

  const firstRecord = (page - 1) * limit + 1;
  const lastRecord = Math.min(page * limit, total);
  const abaAtual = abas.find((a) => a.key === abaAtiva) || null;
  const temAcoes = resource.canUpdate || resource.canDelete || Boolean(extraRowActions);

  const tabBar = (
    <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
      <button
        onClick={() => setAbaAtiva(LIST_TAB)}
        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors cursor-pointer ${
          abaAtiva === LIST_TAB
            ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-400 border-b-blue-600'
            : 'border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
        }`}
      >
        <List className="w-3.5 h-3.5" />
        <span>{resource.label}</span>
        <span className="text-[10px] font-mono text-stone-400">{total}</span>
      </button>

      {abas.map((aba) => {
        const ativa = abaAtiva === aba.key;
        return (
          <div
            key={aba.key}
            className={`flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 transition-colors ${
              ativa ? 'bg-white dark:bg-stone-900 border-b-blue-600' : 'border-b-transparent hover:bg-stone-200/60 dark:hover:bg-stone-800/60'
            }`}
          >
            <button
              onClick={() => setAbaAtiva(aba.key)}
              className={`flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                ativa ? 'text-blue-700 dark:text-blue-400' : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              {aba.record === null ? <FilePlus2 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
              <span>{aba.titulo}</span>
            </button>
            <button
              onClick={() => fecharAba(aba.key)}
              title="Fechar aba"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );

  const listPanel = (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0 bg-white dark:bg-stone-900 overflow-x-auto overflow-y-hidden">
        <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate min-w-0">
          {isLoading
            ? 'Carregando registros…'
            : total === 0
            ? 'Nenhum registro encontrado'
            : `${firstRecord}–${lastRecord} de ${total} registro(s) • tabela ${resource.table}`}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {toolbarExtra}

          {isSearchable && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput.trim());
                setPage(1);
              }}
              className="relative w-52 sm:w-64 shrink-0"
            >
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
              <input
                id={`busca-${resource.name}`}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar…"
                className={`${INPUT_CLASS} w-full pl-9 pr-8`}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                    setPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          )}

          {temBuscaAvancada && (
            <button
              onClick={() => setBuscaAvancadaAberta((a) => !a)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
                buscaAvancadaAberta || filtros.length > 0
                  ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300'
                  : 'border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Busca avançada</span>
              {filtros.length > 0 && (
                <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 rounded-full">{filtros.length}</span>
              )}
            </button>
          )}

          <select
            value={limit}
            onChange={(e) => {
              setLimit(Number(e.target.value));
              setPage(1);
            }}
            title="Registros por página"
            className={`${INPUT_CLASS} shrink-0 cursor-pointer`}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>

          {resource.canCreate && (
            <button
              onClick={abrirAbaNovo}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Novo</span>
            </button>
          )}
        </div>
      </div>

      {temBuscaAvancada && buscaAvancadaAberta && (
        <AdvancedSearch
          resource={resource as any}
          refOptions={{}}
          aplicados={filtros}
          onAplicar={(novos) => {
            setFiltros(novos);
            setPage(1);
          }}
          onFechar={() => setBuscaAvancadaAberta(false)}
        />
      )}

      {error && <MensagemErro texto={error} className="mx-4 mt-3 shrink-0" />}

      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-10">
            <tr className="bg-stone-50 dark:bg-stone-950/90 backdrop-blur-xs">
              {listedFields.map((f) => {
                const isSorted = sort === f.name;
                return (
                  <th
                    key={f.name}
                    onClick={() => handleSort(f.name)}
                    className={`px-3 py-2.5 text-left font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap cursor-pointer select-none hover:bg-stone-100 dark:hover:bg-stone-800/60 transition-colors border-b border-stone-200 dark:border-stone-800 ${
                      f.width ? WIDTH_CLASS[f.width] : ''
                    }`}
                    title={`Ordenar por ${f.label}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {f.label}
                      {isSorted &&
                        (dir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                        ))}
                    </span>
                  </th>
                );
              })}
              {temAcoes && (
                <th className="sticky right-0 z-20 px-3 py-2.5 text-right font-semibold text-stone-600 dark:text-stone-300 w-24 border-b border-l border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">
                  Ações
                </th>
              )}
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={listedFields.length + 1} className="px-3 py-12 text-center">
                  <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando registros…</span>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={listedFields.length + 1} className="px-3 py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-stone-400">
                    <Inbox className="w-8 h-8" />
                    <span className="text-sm font-medium text-stone-600 dark:text-stone-300">
                      {search || filtros.length > 0 ? 'Nenhum registro corresponde aos filtros informados' : `Nenhum registro em ${resource.label}`}
                    </span>
                  </div>
                </td>
              </tr>
            )}

            {!isLoading &&
              rows.map((row) => {
                const id = recordId(row);
                const abertaEmAba = abas.some((a) => a.key === `edit:${id}`);
                return (
                  <tr
                    key={id}
                    onDoubleClick={() => resource.canUpdate && abrirAbaEdicao(row)}
                    className={`transition-colors ${
                      abertaEmAba ? 'bg-blue-50 dark:bg-stone-800' : 'bg-white dark:bg-stone-900 hover:bg-stone-50 dark:hover:bg-stone-800'
                    }`}
                  >
                    {listedFields.map((f) => (
                      <td
                        key={f.name}
                        className="px-3 py-2.5 text-stone-700 dark:text-stone-300 align-middle max-w-xs truncate border-b border-stone-100 dark:border-stone-800/60"
                      >
                        <CellValue field={f} row={row} />
                      </td>
                    ))}
                    {temAcoes && (
                      <td className="sticky right-0 z-[5] px-3 py-2.5 text-right whitespace-nowrap bg-inherit border-b border-l border-stone-100 dark:border-stone-800/60 shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.18)]">
                        <div className="inline-flex items-center gap-1">
                          {extraRowActions?.(row)}
                          {resource.canUpdate && (
                            <button
                              onClick={() => abrirAbaEdicao(row)}
                              title="Editar em nova aba"
                              className="p-1.5 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {resource.canDelete && (
                            <button
                              onClick={() => {
                                setDeleting(row);
                                setDeleteError(null);
                              }}
                              title="Excluir registro"
                              className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-2.5 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">
            Página {page} de {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {abas.length > 0 && tabBar}

      {abaAtual ? (
        <RecordForm
          key={abaAtual.key}
          resource={resource}
          record={abaAtual.record}
          renderExtra={renderFormExtra}
          onCancel={() => fecharAba(abaAtual.key)}
          onSave={(payload) => handleSave(abaAtual, payload)}
        />
      ) : (
        listPanel
      )}

      {deleting && (
        <ConfirmDialog
          titulo={`Excluir ${resource.labelSingular}?`}
          mensagem={
            <>
              O registro <strong className="font-mono">#{recordId(deleting)}</strong> ({recordLabel(deleting)}) será removido
              definitivamente da tabela <strong>{resource.table}</strong>. Esta ação não pode ser desfeita.
            </>
          }
          textoConfirmar={isDeletingBusy ? 'Excluindo…' : 'Excluir'}
          perigo
          ocupado={isDeletingBusy}
          erro={deleteError}
          onConfirmar={handleDelete}
          onCancelar={() => setDeleting(null)}
        />
      )}
    </div>
  );
};
