## Problema

As funções de banco existem, mas os **triggers** que as disparam não estão ativos. Por isso, ao mudar o status ou cliente de um equipamento, nada é gravado em `movements` e o histórico fica vazio. Verifiquei diretamente no banco — não há triggers em nenhuma tabela.

## O que será feito

Criar (ou recriar) 4 triggers no banco:

1. **`equipment_movement_log`** em `public.equipment` — após INSERT ou UPDATE, grava uma linha em `movements` registrando o status/cliente anterior e o novo. É o que faz o histórico funcionar.
2. **`equipment_updated_at`** em `public.equipment` — atualiza `updated_at` em cada UPDATE.
3. **`clients_updated_at`** em `public.clients` — idem para clientes.
4. **`on_auth_user_created`** em `auth.users` — cria automaticamente o registro em `profiles` quando um novo usuário se cadastra.

Como as funções `log_equipment_movement`, `set_updated_at` e `handle_new_user` já existem corretamente (com `SECURITY DEFINER` e `search_path` definidos), só é preciso anexá-las às tabelas como triggers.

## Detalhes técnicos

Migration SQL (com `DROP TRIGGER IF EXISTS` antes para ser idempotente):

```sql
DROP TRIGGER IF EXISTS equipment_movement_log ON public.equipment;
CREATE TRIGGER equipment_movement_log
  AFTER INSERT OR UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.log_equipment_movement();

DROP TRIGGER IF EXISTS equipment_updated_at ON public.equipment;
CREATE TRIGGER equipment_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS clients_updated_at ON public.clients;
CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

A função `log_equipment_movement` já trata corretamente os dois casos:
- **INSERT** → grava movimentação com `from_status = NULL` e `to_status = NEW.status`.
- **UPDATE** → grava apenas se `status` ou `current_client_id` mudaram, registrando os valores antigos e novos.

Nenhuma alteração no frontend é necessária — a tela de histórico (`HistoryView` em `src/routes/equipamentos.tsx`) já lê de `movements` e o realtime já está configurado.

## Como validar

1. Cadastrar um equipamento → deve aparecer 1 entrada de "Cadastro" no histórico.
2. Mudar o status (ex: Disponível → Manutenção) → nova entrada com a transição.
3. Vincular a um cliente → nova entrada com o cliente de destino.
