import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { User, Plus, Trash2, Calendar, Pencil, CheckCircle2, ShieldAlert, X, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/pessoas")({
  head: () => ({ meta: [{ title: "Cadastro de Pessoas — CCO Busato" }] }),
  component: () => <AppLayout><PessoasPage /></AppLayout>,
});

type Person = {
  id: string;
  created_at?: string;
  name: string;
  plate_tag: string | null;
  equipment_types: string[];
  shift: string;
  team_letter: string;
  vacation_start: string | null;
  vacation_end: string | null;
  unavailability: string[];
  owner_id?: string;
};

function PessoasPage() {
  const { user } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Form states
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [plateTag, setPlateTag] = useState("");
  const [eqTypeInput, setEqTypeInput] = useState("");
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [shift, setShift] = useState("DIA");
  const [teamLetter, setTeamLetter] = useState("A");
  const [vacationStart, setVacationStart] = useState("");
  const [vacationEnd, setVacationEnd] = useState("");
  const [unavailDateInput, setUnavailDateInput] = useState("");
  const [unavailability, setUnavailability] = useState<string[]>([]);

  const loadPeople = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("people")
        .select("*")
        .order("name", { ascending: true });
      
      if (error) throw error;
      setPeople((data ?? []) as Person[]);
      localStorage.setItem("local_people", JSON.stringify(data ?? []));
    } catch (_) {
      // Fallback
      const local = JSON.parse(localStorage.getItem("local_people") || "[]");
      setPeople(local);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadPeople();
  }, [user]);

  const handleOpenAdd = () => {
    setEditingId(null);
    setName("");
    setPlateTag("");
    setEqTypeInput("");
    setEquipmentTypes([]);
    setShift("DIA");
    setTeamLetter("A");
    setVacationStart("");
    setVacationEnd("");
    setUnavailDateInput("");
    setUnavailability([]);
    setIsOpen(true);
  };

  const handleOpenEdit = (p: Person) => {
    setEditingId(p.id);
    setName(p.name);
    setPlateTag(p.plate_tag || "");
    setEqTypeInput("");
    setEquipmentTypes(p.equipment_types || []);
    setShift(p.shift || "DIA");
    setTeamLetter(p.team_letter || "A");
    setVacationStart(p.vacation_start || "");
    setVacationEnd(p.vacation_end || "");
    setUnavailDateInput("");
    setUnavailability(p.unavailability || []);
    setIsOpen(true);
  };

  const handleAddEquipmentType = () => {
    const val = eqTypeInput.trim().toUpperCase();
    if (val && !equipmentTypes.includes(val)) {
      setEquipmentTypes([...equipmentTypes, val]);
      setEqTypeInput("");
    }
  };

  const handleRemoveEquipmentType = (type: string) => {
    setEquipmentTypes(equipmentTypes.filter(t => t !== type));
  };

  const handleAddUnavailDate = () => {
    const dateStr = unavailDateInput;
    if (dateStr && !unavailability.includes(dateStr)) {
      setUnavailability([...unavailability, dateStr].sort());
      setUnavailDateInput("");
    }
  };

  const handleRemoveUnavailDate = (date: string) => {
    setUnavailability(unavailability.filter(d => d !== date));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("O nome é obrigatório");
      return;
    }

    const payload: Omit<Person, "id"> & { id?: string } = {
      name: name.trim(),
      plate_tag: plateTag.trim() || null,
      equipment_types: equipmentTypes,
      shift,
      team_letter: teamLetter.trim().toUpperCase(),
      vacation_start: vacationStart || null,
      vacation_end: vacationEnd || null,
      unavailability: unavailability,
      owner_id: user?.id
    };

    try {
      if (editingId) {
        payload.id = editingId;
        const { error } = await supabase.from("people" as any).update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success("Cadastro atualizado com sucesso!");
      } else {
        const { error } = await supabase.from("people" as any).insert(payload);
        if (error) throw error;
        toast.success("Pessoa cadastrada com sucesso!");
      }
      setIsOpen(false);
      loadPeople();
    } catch (_) {
      // Local fallback saving
      const local = JSON.parse(localStorage.getItem("local_people") || "[]");
      if (editingId) {
        const updated = local.map((p: Person) => p.id === editingId ? { ...p, ...payload } : p);
        localStorage.setItem("local_people", JSON.stringify(updated));
        setPeople(updated);
      } else {
        const newPerson = { ...payload, id: Math.random().toString(36).substring(2) } as Person;
        const updated = [...local, newPerson];
        localStorage.setItem("local_people", JSON.stringify(updated));
        setPeople(updated);
      }
      toast.success("Salvo localmente (Offline).");
      setIsOpen(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir esta pessoa?")) return;
    try {
      const { error } = await supabase.from("people" as any).delete().eq("id", id);
      if (error) throw error;
      toast.success("Registro excluído com sucesso!");
      loadPeople();
    } catch (_) {
      const local = JSON.parse(localStorage.getItem("local_people") || "[]");
      const updated = local.filter((p: Person) => p.id !== id);
      localStorage.setItem("local_people", JSON.stringify(updated));
      setPeople(updated);
      toast.success("Excluído localmente.");
    }
  };

  const filteredPeople = useMemo(() => {
    const q = search.toLowerCase().trim();
    return people.filter(p => 
      p.name.toLowerCase().includes(q) ||
      (p.plate_tag || "").toLowerCase().includes(q) ||
      p.team_letter.toLowerCase().includes(q) ||
      p.shift.toLowerCase().includes(q) ||
      (p.equipment_types || []).some(t => t.toLowerCase().includes(q))
    );
  }, [people, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
            <User className="h-8 w-8 text-primary" />
            <span>Pessoas e Operadores</span>
          </h1>
          <p className="text-muted-foreground mt-1">Gerenciamento de turnos, férias, indisponibilidades e permissões de equipamentos.</p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary hover:bg-primary/95 flex items-center gap-2">
          <Plus className="h-5 w-5" /> Adicionar Pessoa
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input 
          placeholder="Buscar por nome, placa, equipamento, letra..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md bg-card border-muted-foreground/20"
        />
      </div>

      <Card className="border-muted-foreground/20 shadow-md">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Lista de Operadores ({filteredPeople.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="font-bold">Nome</TableHead>
                  <TableHead className="font-bold">Placa/Tag Padrão</TableHead>
                  <TableHead className="font-bold">Equipamentos Operados</TableHead>
                  <TableHead className="font-bold">Turno / Letra</TableHead>
                  <TableHead className="font-bold">Férias</TableHead>
                  <TableHead className="font-bold">Indisponibilidades</TableHead>
                  <TableHead className="text-right font-bold w-[120px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPeople.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nenhuma pessoa encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPeople.map((p) => {
                    const todayStr = format(new Date(), "yyyy-MM-dd");
                    const onVacation = p.vacation_start && p.vacation_end && 
                      todayStr >= p.vacation_start && todayStr <= p.vacation_end;
                    const isUnavailToday = (p.unavailability || []).includes(todayStr);

                    return (
                      <TableRow key={p.id} className="hover:bg-muted/20">
                        <TableCell className="font-semibold text-foreground">
                          <div className="flex items-center gap-2">
                            <span>{p.name}</span>
                            {onVacation && (
                              <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px] py-0">Férias</Badge>
                            )}
                            {isUnavailToday && (
                              <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] py-0">Indisponível</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{p.plate_tag || "—"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1 max-w-[280px]">
                            {p.equipment_types && p.equipment_types.length > 0 ? (
                              p.equipment_types.map((type, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">
                                  {type}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground text-xs italic">Nenhum</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="font-medium">{p.shift}</span>
                          <span className="text-muted-foreground mx-1">•</span>
                          <span className="text-muted-foreground font-mono">Letra {p.team_letter}</span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.vacation_start && p.vacation_end ? (
                            <span>{format(new Date(p.vacation_start + "T12:00:00"), "dd/MM/yyyy")} a {format(new Date(p.vacation_end + "T12:00:00"), "dd/MM/yyyy")}</span>
                          ) : (
                            <span className="italic text-muted-foreground/75">Não registrado</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.unavailability && p.unavailability.length > 0 ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">{p.unavailability.length} dia(s)</span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">Nenhuma</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button size="icon" variant="ghost" onClick={() => handleOpenEdit(p)} className="h-8 w-8 hover:text-primary">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <User className="h-6 w-6 text-primary" />
              {editingId ? "Editar Registro" : "Adicionar Nova Pessoa"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-5 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="person-name">Nome Completo</Label>
                <Input id="person-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: João da Silva" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="person-plate">Placa/Tag Padrão</Label>
                <Input id="person-plate" value={plateTag} onChange={(e) => setPlateTag(e.target.value)} placeholder="Ex: CAM-123 ou TAG-45" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="person-shift">Turno</Label>
                <Select value={shift} onValueChange={setShift}>
                  <SelectTrigger id="person-shift">
                    <SelectValue placeholder="Selecione o turno" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DIA">DIA</SelectItem>
                    <SelectItem value="NOITE">NOITE</SelectItem>
                    <SelectItem value="NOITE (P1)">NOITE (P1)</SelectItem>
                    <SelectItem value="NOITE (P2)">NOITE (P2)</SelectItem>
                    <SelectItem value="TURNO A">TURNO A</SelectItem>
                    <SelectItem value="TURNO B">TURNO B</SelectItem>
                    <SelectItem value="TURNO C">TURNO C</SelectItem>
                    <SelectItem value="TURNO D">TURNO D</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="person-letter">Letra de Atuação</Label>
                <Input id="person-letter" value={teamLetter} onChange={(e) => setTeamLetter(e.target.value)} placeholder="Ex: A" />
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <Label>Tipos de Equipamentos que Opera</Label>
              <div className="flex gap-2">
                <Input 
                  value={eqTypeInput} 
                  onChange={(e) => setEqTypeInput(e.target.value)} 
                  placeholder="Ex: CAMINHÃO BASCULANTE" 
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddEquipmentType(); } }}
                />
                <Button type="button" onClick={handleAddEquipmentType} variant="secondary">Adicionar</Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-2">
                {equipmentTypes.map((type, idx) => (
                  <Badge key={idx} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-1">
                    <span>{type}</span>
                    <button type="button" onClick={() => handleRemoveEquipmentType(type)} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t pt-3">
              <Label>Período de Férias</Label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Início</span>
                  <Input type="date" value={vacationStart} onChange={(e) => setVacationStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Término</span>
                  <Input type="date" value={vacationEnd} onChange={(e) => setVacationEnd(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t pt-3">
              <Label>Indisponibilidades (Múltiplos Dias)</Label>
              <div className="flex gap-2">
                <Input 
                  type="date" 
                  value={unavailDateInput} 
                  onChange={(e) => setUnavailDateInput(e.target.value)} 
                />
                <Button type="button" onClick={handleAddUnavailDate} variant="secondary">Bloquear Dia</Button>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-2 max-h-[120px] overflow-y-auto border rounded p-2 bg-muted/20">
                {unavailability.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">Nenhum dia bloqueado.</span>
                ) : (
                  unavailability.map((date, idx) => (
                    <Badge key={idx} variant="destructive" className="flex items-center gap-1 pl-2 pr-1 py-1">
                      <span>{format(new Date(date + "T12:00:00"), "dd/MM/yyyy")}</span>
                      <button type="button" onClick={() => handleRemoveUnavailDate(date)} className="text-destructive-foreground hover:text-white">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))
                )}
              </div>
            </div>

            <DialogFooter className="border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar Alterações</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
