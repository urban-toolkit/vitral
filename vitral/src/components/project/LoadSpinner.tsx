import classes from './LoadSpinner.module.css'

type LoadSpinnerProps = {
    loading: boolean;
};

export function LoadSpinner({ loading }: LoadSpinnerProps) {

    return (
        <>
            {
            loading 
            ? 
                <div className={classes.spinnerContainer}>
                    <div 
                        className={classes.spinner}
                        aria-label="Loading"
                    />
                </div> 
            : 
                null}
        </>

    );
}
