FROM rocker/r2u:24.04

RUN install.r plumber cytometree IFC webutils matrixStats

WORKDIR /app

COPY api.R .

EXPOSE 8000

CMD ["R", "-e", "plumber::plumb('api.R')$run(host='0.0.0.0',port=as.numeric(Sys.getenv('PORT', unset = 8000)))"]
