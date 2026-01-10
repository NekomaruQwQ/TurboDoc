#![expect(clippy::needless_continue, reason = "generated code from darling::FromAttributes")]

use proc_macro2::*;
use quote::quote;
use syn::*;
use syn::parse::*;
use tap::prelude::*;
use darling::*;

struct ApiNameOf {
    args: ApiNameOfArgs,
    expr: Expr,
}

impl Parse for ApiNameOf {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        Ok(Self {
            args:
                ApiNameOfArgs::from_attributes(&input.call(Attribute::parse_outer)?)
                    .map_err(|err| syn::Error::new(input.span(), err))?,
            expr: input.parse()?,
        })
    }
}

#[derive(FromAttributes)]
#[darling(attributes(api_name_args))]
struct ApiNameOfArgs {
    type_name: Path,
    type_name_of: Path,
}

#[proc_macro]
pub fn api_name_of_internal(input: proc_macro::TokenStream) -> proc_macro::TokenStream {
    let ApiNameOf { args, expr } =
        syn::parse::<ApiNameOf>(input)
            .expect("failed to parse input");
    let ApiNameOfArgs {
        type_name,
        type_name_of,
    } = args;

    let expr = match expr {
        Expr::Group(ExprGroup { expr, .. }) |
        Expr::Paren(ExprParen { expr, .. }) => *expr,
        _ => expr,
    };

    match expr {
        Expr::MethodCall(ExprMethodCall {
            ref receiver,
            ref method,
            ref turbofish,
            ..
        }) => {
            let method_ident =
                method.to_string();
            let method_generics =
                turbofish
                    .as_ref()
                    .map_or_else(
                        || quote!(""),
                        |turbofish| display_generic_args(turbofish, &type_name));
            quote!(format!(
                "{}::{}{}",
                #type_name_of(&#receiver).trim_start_matches('&'),
                #method_ident,
                #method_generics))
        },
        Expr::Call(ExprCall { ref func, .. }) =>
            match func.as_ref() {
                &Expr::Path(ExprPath { path: Path { leading_colon, ref segments }, .. }) => {
                    let method =
                        segments
                            .last()
                            .expect("empty path");
                    let method_ident =
                        method.ident.to_string();
                    let method_generics =
                        if let PathArguments::AngleBracketed(ref args) = method.arguments {
                            display_generic_args(args, &type_name)
                        } else {
                            quote!("")
                        };
                    if let Some(segment) =
                        segments.iter().nth_back(1) &&
                        segment
                            .ident
                            .to_string()
                            .chars()
                            .next()
                            .unwrap_or(' ')
                            .is_ascii_uppercase() {
                        let type_path = Path {
                            leading_colon,
                            segments:
                                segments
                                    .iter()
                                    .take(segments.len() - 1)
                                    .cloned()
                                    .collect(),
                        };
                        quote!(format!(
                            "{}::{}{}",
                            #type_name::<#type_path>(),
                            #method_ident,
                            #method_generics))
                    } else {
                        quote!(format!(
                            "{}{}",
                            #method_ident,
                            #method_generics))
                    }
                },
                _ => panic!("invalid syntax"),
            },
        _ => panic!("invalid syntax: {expr:?}"),
    }.into()
}

fn display_generic_args(args: &AngleBracketedGenericArguments, type_name: &Path) -> TokenStream {
    args.args
        .iter()
        .map(|arg| match arg {
            &GenericArgument::Lifetime(ref lifetime) => {
                let lifetime = lifetime.to_string();
                quote!(#lifetime.to_string())
            },
            &GenericArgument::Type(ref ty) => {
                quote!(#type_name::<#ty>())
            },
            &GenericArgument::Const(ref expr) => {
                panic!("unsupported const generic argument: {}", expr.to_token_stream())
            },
            _ => {
                panic!("unexpected generic argument: {}", arg.to_token_stream())
            },
        })
        .collect::<Vec<_>>()
        .pipe(|args| quote!(format!("::<{}>", [#(#args),*].join(", "))))
}
