import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/*
Qual campo é obrigatório depende do tipo de conta, então nenhum é exigido
aqui — a checagem fica no `UsersService.deleteAccount`:
- conta com senha  -> `password` obrigatório (bcrypt.compare, inalterado);
- conta só-Google  -> `googleCredential` obrigatório: um id_token fresco do
  Google, verificado pelo mesmo helper do POST /auth/google, com o `sub`
  casando um LinkedAccount deste usuário. É a prova de identidade que
  substitui a senha antes de destruir a conta (ARCHITECTURE.md §7).
*/
export class DeleteAccountDto {

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  googleCredential?: string;

}
