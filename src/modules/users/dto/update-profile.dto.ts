import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

/*
Nome exibido no perfil. Trim ANTES de validar o tamanho: " " (só espaços)
não pode passar como "nome válido de 1 caractere", e "  Maria  " não deve
gravar os espaços extras no banco. Sem isso, o `@Patch('me')` aceitava
qualquer coisa — o corpo era tipado como `{ name: string }` inline, que
desaparece em runtime e não valida nada.
*/
export class UpdateProfileDto {

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Nome inválido' })
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @Length(2, 80, { message: 'O nome deve ter entre 2 e 80 caracteres' })
  name: string;

}
